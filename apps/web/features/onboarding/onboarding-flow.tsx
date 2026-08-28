"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { getGetOnboardingQueryKey, useListCurrencies } from "../../generated/api";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../../components/ui/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { WalletForm } from "../wallets/wallet-form";
import { onboardingComplete, useOnboarding } from "./use-onboarding";
import { getDetectedTimezone, getTimezoneOptions } from "./timezones";

export { getTimezoneOptions } from "./timezones";

function errorText(error: unknown): string {
  const value = error as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
}

function matchesCurrency(code: string, currencyCodes: string[]): boolean {
  return currencyCodes.includes(code.trim().toUpperCase());
}

export function OnboardingFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const onboarding = useOnboarding();
  const currencies = useListCurrencies({ query: { retry: 1 } });
  const timezoneId = useId();
  const currencyId = useId();
  const timezoneHelpId = `${timezoneId}-help`;
  const timezoneErrorId = `${timezoneId}-error`;
  const currencyHelpId = `${currencyId}-help`;
  const currencyErrorId = `${currencyId}-error`;
  const [timezone, setTimezone] = useState(() => getDetectedTimezone());
  const [currency, setCurrency] = useState("");
  const [editingTimezone, setEditingTimezone] = useState(false);
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const redirected = useRef(false);
  const timezoneOptions = getTimezoneOptions();
  const currencyList = currencies.data?.data ?? [];
  const currencyCodes = currencyList.map((item) => item.code);
  const timezoneMatches = timezoneOptions.includes(timezone.trim());
  const currencyValue = currency.trim().toUpperCase();
  const currencyMatches = matchesCurrency(currencyValue, currencyCodes);

  useEffect(() => {
    if (!onboarding.state) return;
    setTimezone(onboarding.state.timezone ?? getDetectedTimezone());
    setCurrency(onboarding.state.default_currency_code ?? "");
    setEditingTimezone(false);
    setTimezoneOpen(false);
    setStatus(undefined);
  }, [onboarding.state]);

  useEffect(() => {
    if (!onboarding.state || !onboardingComplete(onboarding.state) || redirected.current) return;
    redirected.current = true;
    router.replace("/app");
  }, [onboarding.state, router]);

  if (onboarding.isPending) {
    return (
      <main className="public-page">
        <Card className="onboarding-card">
          <CardHeader>
            <CardTitle>Checking saved state</CardTitle>
            <CardDescription>Reading your saved account state.</CardDescription>
          </CardHeader>
          <CardContent className="onboarding-stack" aria-live="polite">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-40" />
            <p className="loading-state">Checking setup…</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (onboarding.isError) {
    return (
      <main className="public-page">
        <Card className="onboarding-card">
          <CardHeader>
            <CardTitle>Finish setup</CardTitle>
            <CardDescription>We could not load your onboarding state.</CardDescription>
          </CardHeader>
          <CardContent className="onboarding-stack">
            <Alert variant="destructive">
              <AlertTitle>Could not load your setup.</AlertTitle>
              <AlertDescription>Retry after checking your connection.</AlertDescription>
            </Alert>
            <Button type="button" onClick={() => void onboarding.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!onboarding.state || onboarding.step === "complete") {
    return (
      <main className="public-page">
        <p className="loading-state" aria-live="polite">
          Opening your journal…
        </p>
      </main>
    );
  }

  const showTimezoneField = onboarding.step === "timezone" || editingTimezone;
  const saveLabel =
    onboarding.step === "timezone" || editingTimezone
      ? "Save timezone and currency"
      : "Save currency";

  async function savePreferences() {
    setStatus(undefined);
    if (!timezoneMatches) {
      setStatus({ kind: "error", text: "Choose an exact IANA timezone from the list." });
      return;
    }
    if (!currencyMatches) {
      setStatus({ kind: "error", text: "Choose a currency from the supported registry." });
      return;
    }
    try {
      await onboarding.savePreferences({
        timezone: timezone.trim(),
        default_currency_code: currencyValue,
      });
      setStatus({ kind: "success", text: "Saved. Checking your next setup step…" });
      setEditingTimezone(false);
      setTimezoneOpen(false);
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  function renderPreferencesCard() {
    return (
      <Card className="onboarding-card">
        <CardHeader>
          <p className="muted">Private money journal · Setup</p>
          <h1 className="font-heading text-base leading-snug font-medium">Make Cashmemo useful</h1>
          <CardDescription>
            You can leave and return anytime. Visible setup comes only from saved backend facts.
          </CardDescription>
        </CardHeader>
        <CardContent className="onboarding-stack">
          <section aria-labelledby="onboarding-step-title" className="onboarding-section">
            <h2 id="onboarding-step-title">
              {onboarding.step === "timezone"
                ? "Confirm your timezone"
                : "Choose your default currency"}
            </h2>
            <p className="muted">
              {onboarding.step === "timezone"
                ? "We use your exact IANA timezone for local dates, months, and recurring transactions."
                : "This only preselects new wallets. Cashmemo never converts between currencies."}
            </p>

            {showTimezoneField ? (
              <Field data-invalid={status?.kind === "error" && !timezoneMatches ? "true" : undefined}>
                <FieldLabel htmlFor={timezoneId}>Reporting timezone</FieldLabel>
                <FieldContent>
                  <Combobox
                    items={timezoneOptions}
                    value={timezoneMatches ? timezone.trim() : null}
                    inputValue={timezone}
                    onValueChange={(value) => {
                      setTimezone(typeof value === "string" ? value : "");
                      setTimezoneOpen(false);
                    }}
                    onInputValueChange={(value) => {
                      setTimezone(value);
                      setTimezoneOpen(true);
                    }}
                    open={timezoneOpen}
                    onOpenChange={setTimezoneOpen}
                    inline
                    autoHighlight
                  >
                    <ComboboxInput
                      id={timezoneId}
                      placeholder="Search IANA timezone"
                      autoComplete="off"
                      aria-describedby={timezoneMatches ? timezoneHelpId : `${timezoneHelpId} ${timezoneErrorId}`}
                      aria-invalid={!timezoneMatches}
                    >
                      <Search className="shell-link-icon text-muted-foreground" aria-hidden="true" />
                    </ComboboxInput>
                    <div className="timezone-combobox" data-open={timezoneOpen ? "true" : "false"}>
                      <ComboboxEmpty>No matching timezone.</ComboboxEmpty>
                      <ComboboxList>
                        {(item: string) => (
                          <ComboboxItem key={item} value={item}>
                            {item}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </div>
                  </Combobox>
                  <FieldDescription id={timezoneHelpId}>
                    Detected first: {timezoneOptions[0]}. Browser timezone only suggests; saved server
                    state stays authoritative.
                  </FieldDescription>
                  {!timezoneMatches ? (
                    <FieldError id={timezoneErrorId}>Choose an exact IANA timezone.</FieldError>
                  ) : null}
                </FieldContent>
              </Field>
            ) : null}

            <Field data-invalid={status?.kind === "error" && !currencyMatches ? "true" : undefined}>
              <FieldLabel htmlFor={currencyId}>Default currency</FieldLabel>
              <FieldContent>
                <Input
                  id={currencyId}
                  value={currency}
                  onChange={(event) => {
                    setCurrency(event.target.value.toUpperCase());
                  }}
                  autoComplete="off"
                  placeholder="USD"
                  aria-describedby={
                    currencyMatches ? currencyHelpId : `${currencyHelpId} ${currencyErrorId}`
                  }
                  aria-invalid={!currencyMatches}
                />
                <FieldDescription id={currencyHelpId}>
                  Enter one supported currency code: {currencyCodes.join(", ")}.
                </FieldDescription>
                {!currencyMatches ? (
                  <FieldError id={currencyErrorId}>Choose a supported currency code.</FieldError>
                ) : null}
              </FieldContent>
            </Field>
          </section>

          {status ? (
            status.kind === "error" ? (
              <Alert variant="destructive">
                <AlertTitle>Could not save your preferences.</AlertTitle>
                <AlertDescription>{status.text}</AlertDescription>
              </Alert>
            ) : (
              <div role="status" className="success">
                {status.text}
              </div>
            )
          ) : null}

          <div className="onboarding-actions">
            <Button
              type="button"
              onClick={() => void savePreferences()}
              disabled={
                onboarding.isMutating || currencies.isPending || currencies.isError || !timezoneMatches || !currencyMatches
              }
              className="onboarding-primary"
            >
              {saveLabel}
            </Button>
            {onboarding.step === "currency" ? (
              <Button
                type="button"
                variant="quiet"
                aria-expanded={showTimezoneField}
                onClick={() => {
                  setEditingTimezone((current) => !current);
                  setTimezoneOpen((current) => !showTimezoneField || current);
                }}
              >
                Back
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <main className="public-page">
      {onboarding.step === "wallet" ? (
        <WalletForm
          key={onboarding.state.default_currency_code ?? "wallet"}
          defaultCurrency={onboarding.state.default_currency_code ?? currencyValue}
          submitLabel="Create first wallet"
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
          }}
        />
      ) : (
        renderPreferencesCard()
      )}
    </main>
  );
}
