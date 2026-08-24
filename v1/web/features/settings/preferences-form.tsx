"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetOnboardingQueryKey, useGetOnboarding, useListCurrencies, useUpdatePreferences } from "../../generated/api";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";

function browserTimezone(): string {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return resolved.length > 0 ? resolved : "UTC";
}

export function PreferencesForm() {
  const onboarding = useGetOnboarding({ query: { retry: false } });
  const currencies = useListCurrencies({ query: { retry: false } });
  const update = useUpdatePreferences();
  const client = useQueryClient();
  const [timezone, setTimezone] = useState(browserTimezone);
  const [chosenCurrency, setChosenCurrency] = useState("");
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const savedCurrency = onboarding.data?.data.default_currency_code ?? "";
  const currency = chosenCurrency.length > 0 ? chosenCurrency : savedCurrency;

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setStatus(undefined);
    if (!timezone.trim() || !currency) { setStatus({ kind: "error", text: "Choose timezone and default currency." }); return; }
    try { await update.mutateAsync({ data: { timezone: timezone.trim(), default_currency_code: currency } }); await client.invalidateQueries({ queryKey: getGetOnboardingQueryKey() }); setStatus({ kind: "success", text: "Preferences saved. Future server reports use these settings." }); }
    catch (error) { setStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not save preferences." }); }
  }

  return <form className="dialog preferences-form" onSubmit={event => void submit(event)}><h2>Journal preferences</h2><p>Timezone defines server reporting months, local dates, and recurring schedules.</p><p>Default currency only preselects new entries; it never converts or combines currencies.</p><FormField label="Timezone" htmlFor="settings-timezone"><input id="settings-timezone" className="input" value={timezone} onChange={event => { setTimezone(event.target.value); }} list="settings-timezones" autoComplete="off" /><datalist id="settings-timezones"><option value="UTC" /><option value="Asia/Jakarta" /></datalist></FormField><FormField label="Default currency" htmlFor="settings-currency"><select id="settings-currency" className="input" value={currency} onChange={event => { setChosenCurrency(event.target.value); }}><option value="">Choose currency</option>{currencies.data?.data.map(item => <option key={item.code} value={item.code}>{item.code} — {item.display_name}</option>)}</select></FormField><Button type="submit" disabled={update.isPending || onboarding.isPending || currencies.isPending}>Save preferences</Button>{status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}</form>;
}
