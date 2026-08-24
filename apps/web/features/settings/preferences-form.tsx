"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetOnboardingQueryKey,
  useGetOnboarding,
  useListCurrencies,
  useUpdatePreferences,
} from "../../generated/api";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { getTimezoneOptions } from "../onboarding/timezones";

export function PreferencesForm() {
  const onboarding = useGetOnboarding({ query: { retry: false } });
  const currencies = useListCurrencies({ query: { retry: false } });
  const update = useUpdatePreferences();
  const client = useQueryClient();
  const [timezoneOptions] = useState(getTimezoneOptions);
  const [timezoneOverride, setTimezoneOverride] = useState<string>();
  const [chosenCurrency, setChosenCurrency] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<{
    timezone?: string;
    currency?: string;
  }>({});
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const savedCurrency = onboarding.data?.data.default_currency_code ?? "";
  const currency = chosenCurrency ?? savedCurrency;
  const savedTimezone = onboarding.data?.data.timezone_configured
    ? (onboarding.data.data.timezone ?? "")
    : (timezoneOptions[0] ?? "UTC");
  const timezone = timezoneOverride ?? savedTimezone;

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(undefined);
    if (!onboarding.data) return;
    const errors = {
      timezone: timezone.trim() ? undefined : "Choose a timezone.",
      currency: currency ? undefined : "Choose a default currency.",
    };
    setFieldErrors(errors);
    if (errors.timezone || errors.currency) return;
    try {
      await update.mutateAsync({
        data: { timezone: timezone.trim(), default_currency_code: currency },
      });
      await client.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
      setStatus({
        kind: "success",
        text: "Preferences saved. Future server reports use these settings.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not save preferences.",
      });
    }
  }

  if (onboarding.isPending || currencies.isPending) {
    return (
      <div className="dialog" role="status">
        Loading preferences…
      </div>
    );
  }
  if (onboarding.isError || currencies.isError) {
    return (
      <div className="dialog">
        <p role="alert">Could not load preferences.</p>
        <Button
          type="button"
          onClick={() => {
            setFieldErrors({});
            if (onboarding.isError) void onboarding.refetch();
            if (currencies.isError) void currencies.refetch();
          }}
        >
          Retry preferences
        </Button>
      </div>
    );
  }

  return (
    <form className="dialog preferences-form" onSubmit={(event) => void submit(event)}>
      <h2>Journal preferences</h2>
      <p>Timezone defines server reporting months, local dates, and recurring schedules.</p>
      <p>Default currency only preselects new entries; it never converts or combines currencies.</p>
      <FormField label="Timezone" htmlFor="settings-timezone" error={fieldErrors.timezone}>
        <input
          id="settings-timezone"
          className="input"
          value={timezone}
          onChange={(event) => {
            setTimezoneOverride(event.target.value);
            setFieldErrors((current) => ({ ...current, timezone: undefined }));
          }}
          list="settings-timezones"
          autoComplete="off"
        />
      </FormField>
      <datalist id="settings-timezones">
        {timezoneOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <FormField label="Default currency" htmlFor="settings-currency" error={fieldErrors.currency}>
        <select
          id="settings-currency"
          className="input"
          value={currency}
          onChange={(event) => {
            setChosenCurrency(event.target.value);
            setFieldErrors((current) => ({ ...current, currency: undefined }));
          }}
        >
          <option value="">Choose currency</option>
          {currencies.data.data.map((item) => (
            <option key={item.code} value={item.code}>
              {item.code} — {item.display_name}
            </option>
          ))}
        </select>
      </FormField>
      <Button type="submit" disabled={update.isPending}>
        Save preferences
      </Button>
      {status ? (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={status.kind === "error" ? "field-error" : "success"}
        >
          {status.text}
        </p>
      ) : null}
    </form>
  );
}
