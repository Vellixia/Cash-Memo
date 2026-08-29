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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { FormField } from "../../components/ui/form-field";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../../components/ui/combobox";
import { getTimezoneOptions } from "../onboarding/timezones";
import { invalidateTimezoneDependentQueries } from "./timezone-invalidation";

export function PreferencesForm() {
  const onboarding = useGetOnboarding({ query: { retry: false } });
  const currencies = useListCurrencies({ query: { retry: false } });
  const update = useUpdatePreferences();
  const client = useQueryClient();
  const [timezoneOptions] = useState(getTimezoneOptions);
  const [timezoneOverride, setTimezoneOverride] = useState<string>();
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [timezoneConfirmation, setTimezoneConfirmation] = useState<string>();
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

  async function savePreferences() {
    if (!onboarding.data) return;
    try {
      await update.mutateAsync({
        data: { timezone: timezone.trim(), default_currency_code: currency },
      });
      if (timezone.trim() !== savedTimezone) {
        await invalidateTimezoneDependentQueries(client);
      } else {
        await client.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
      }
      setTimezoneConfirmation(undefined);
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

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(undefined);
    if (!onboarding.data) return;
    const errors = {
      timezone: timezoneOptions.includes(timezone.trim())
        ? undefined
        : "Choose a timezone.",
      currency: currency ? undefined : "Choose a default currency.",
    };
    setFieldErrors(errors);
    if (errors.timezone || errors.currency) return;
    if (timezone.trim() !== savedTimezone) {
      setTimezoneConfirmation(timezone.trim());
      return;
    }
    await savePreferences();
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
        <Combobox
          items={timezoneOptions}
          value={timezoneOptions.includes(timezone) ? timezone : null}
          inputValue={timezone}
          onValueChange={(value) => {
            setTimezoneOverride(typeof value === "string" ? value : "");
            setTimezoneOpen(false);
            setFieldErrors((current) => ({ ...current, timezone: undefined }));
          }}
          onInputValueChange={(value) => {
            setTimezoneOverride(value);
            setTimezoneOpen(true);
            setFieldErrors((current) => ({ ...current, timezone: undefined }));
          }}
          open={timezoneOpen}
          onOpenChange={setTimezoneOpen}
          inline
          autoHighlight
        >
          <ComboboxInput
            id="settings-timezone"
            placeholder="Search IANA timezone"
            autoComplete="off"
            aria-describedby={fieldErrors.timezone ? "settings-timezone-error" : undefined}
            aria-invalid={fieldErrors.timezone ? true : undefined}
          />
          <div className="timezone-combobox" data-open={timezoneOpen ? "true" : "false"}>
            <ComboboxEmpty>No matching timezone.</ComboboxEmpty>
            <ComboboxList>
              {(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}
            </ComboboxList>
          </div>
        </Combobox>
      </FormField>
      <datalist id="settings-timezones">
        {timezoneOptions.map((option) => <option key={option} value={option} />)}
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
      <AlertDialog
        open={Boolean(timezoneConfirmation)}
        onOpenChange={(open) => { if (!open && !update.isPending) setTimezoneConfirmation(undefined); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change reporting timezone?</AlertDialogTitle>
            <AlertDialogDescription>
              Switching to <strong>{timezoneConfirmation}</strong> changes local interpretation only:
              stored transaction instants stay unchanged; historical grouping may change; dashboard
              and budget boundaries use {timezoneConfirmation}; future recurrence conversion uses
              {" "}{timezoneConfirmation}; existing occurrences and generated timestamps stay unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current timezone</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => void savePreferences()}
              disabled={update.isPending}
            >
              Confirm timezone change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
