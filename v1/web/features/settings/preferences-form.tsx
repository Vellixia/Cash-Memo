"use client";

import { useEffect, useState } from "react";
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
  const [timezone, setTimezone] = useState(() => timezoneOptions[0] ?? "UTC");
  const [timezoneEdited, setTimezoneEdited] = useState(false);
  const [chosenCurrency, setChosenCurrency] = useState("");
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const savedCurrency = onboarding.data?.data.default_currency_code ?? "";
  const currency = chosenCurrency.length > 0 ? chosenCurrency : savedCurrency;

  useEffect(() => {
    if (!timezoneEdited && onboarding.data?.data.timezone_configured) {
      setTimezone(onboarding.data.data.timezone ?? "");
    }
  }, [onboarding.data, timezoneEdited]);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(undefined);
    if (!timezone.trim() || !currency) {
      setStatus({ kind: "error", text: "Choose timezone and default currency." });
      return;
    }
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

  return (
    <form className="dialog preferences-form" onSubmit={(event) => void submit(event)}>
      <h2>Journal preferences</h2>
      <p>Timezone defines server reporting months, local dates, and recurring schedules.</p>
      <p>Default currency only preselects new entries; it never converts or combines currencies.</p>
      <FormField label="Timezone" htmlFor="settings-timezone">
        <input
          id="settings-timezone"
          className="input"
          value={timezone}
          onChange={(event) => {
            setTimezone(event.target.value);
            setTimezoneEdited(true);
          }}
          list="settings-timezones"
          autoComplete="off"
        />
        <datalist id="settings-timezones">
          {timezoneOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </FormField>
      <FormField label="Default currency" htmlFor="settings-currency">
        <select
          id="settings-currency"
          className="input"
          value={currency}
          onChange={(event) => {
            setChosenCurrency(event.target.value);
          }}
        >
          <option value="">Choose currency</option>
          {currencies.data?.data.map((item) => (
            <option key={item.code} value={item.code}>
              {item.code} — {item.display_name}
            </option>
          ))}
        </select>
      </FormField>
      <Button
        type="submit"
        disabled={update.isPending || onboarding.isPending || currencies.isPending}
      >
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
