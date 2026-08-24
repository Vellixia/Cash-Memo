"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getGetOnboardingQueryKey, useListCurrencies } from "../../generated/api";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { WalletForm } from "../wallets/wallet-form";
import { useOnboarding, onboardingComplete } from "./use-onboarding";

function errorText(error: unknown): string {
  const value = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
}

export function OnboardingFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const onboarding = useOnboarding();
  const currencies = useListCurrencies({ query: { retry: 1 } });
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [currency, setCurrency] = useState("");
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const currencyList = currencies.data?.data ?? [];
  const defaultCurrency = useMemo(() => currency || currencyList[0]?.code || "", [currency, currencyList]);

  useEffect(() => {
    if (onboarding.state && onboardingComplete(onboarding.state)) router.replace("/app");
  }, [onboarding.state, router]);

  if (onboarding.isPending) return <main className="public-page"><p className="loading-state" aria-live="polite">Checking setup…</p></main>;
  if (onboarding.isError) return <main className="public-page"><section className="dialog"><h1>Finish setup</h1><p role="alert" className="field-error">Could not load your setup.</p><Button type="button" onClick={() => void onboarding.refetch()}>Retry</Button></section></main>;
  if (!onboarding.state || onboarding.step === "complete") return <main className="public-page"><p className="loading-state" aria-live="polite">Opening your journal…</p></main>;

  async function savePreferences() {
    setStatus(undefined);
    if (!defaultCurrency) { setStatus({ kind: "error", text: "Choose a currency." }); return; }
    try { await onboarding.savePreferences({ timezone, default_currency_code: defaultCurrency }); setStatus({ kind: "success", text: "Preferences saved." }); }
    catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }

  async function seedCategories() {
    setStatus(undefined);
    try { await onboarding.seedCategories(); setStatus({ kind: "success", text: "Starter categories ready." }); }
    catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }

  return <main className="public-page"><section className="onboarding-shell" aria-labelledby="onboarding-title">
    <p className="muted">Private money journal · Setup</p><h1 id="onboarding-title">Make Cashmemo useful</h1><p className="muted">You can leave and return anytime. Progress below comes from your saved account state.</p>
    {onboarding.step === "timezone" ? <div className="dialog onboarding-step"><h2>Confirm your timezone</h2><p>We use it for local dates, months, and recurring transactions.</p><FormField label="Reporting timezone" htmlFor="onboarding-timezone"><select id="onboarding-timezone" className="input" value={timezone} onChange={(event) => { setTimezone(event.target.value); }}><option value={timezone}>{timezone}</option><option value="UTC">UTC</option></select></FormField><Button type="button" onClick={() => void savePreferences()} disabled={onboarding.isMutating}>Save timezone</Button></div> : null}
    {onboarding.step === "currency" ? <div className="dialog onboarding-step"><h2>Choose your default currency</h2><p>This only preselects new wallets. Cashmemo never converts between currencies.</p><FormField label="Default currency" htmlFor="onboarding-currency"><select id="onboarding-currency" className="input" value={defaultCurrency} onChange={(event) => { setCurrency(event.target.value); }} disabled={currencies.isPending}><option value="">Choose currency</option>{currencyList.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.display_name}</option>)}</select></FormField><Button type="button" onClick={() => void savePreferences()} disabled={onboarding.isMutating || currencies.isError || !defaultCurrency}>Save currency</Button></div> : null}
    {onboarding.step === "categories" ? <div className="dialog onboarding-step"><h2>Start with useful categories</h2><p>Starter categories are safe to seed repeatedly. Your own categories stay alongside them with the same controls.</p><Button type="button" onClick={() => void seedCategories()} disabled={onboarding.isMutating}>{onboarding.isMutating ? "Preparing…" : "Add starter categories"}</Button></div> : null}
    {onboarding.step === "wallet" ? <WalletForm defaultCurrency={defaultCurrency} submitLabel="Create first wallet" onSuccess={() => { void queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() }); }} /> : null}
    {status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}
  </section></main>;
}
