"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useEffect, useRef, useState } from "react";
import { useCreateWallet, useListCurrencies, useUpdateWallet } from "../../generated/api";
import type { WalletContract } from "../../generated/api/model/walletContract";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";
import { walletSchema, type WalletFormValues } from "../../lib/validation/wallet";

function errorText(error: unknown): string {
  const value = error as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
}

export function WalletForm({
  wallet,
  defaultCurrency,
  submitLabel,
  onSuccess,
  onCancel,
  showHeading = true,
  embedded = false,
}: {
  wallet?: WalletContract;
  defaultCurrency?: string;
  submitLabel?: string;
  onSuccess?: (wallet: WalletContract) => void;
  onCancel?: () => void;
  showHeading?: boolean;
  embedded?: boolean;
}) {
  const currencies = useListCurrencies({ query: { retry: 1 } });
  const create = useCreateWallet();
  const update = useUpdateWallet();
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const exponentRef = useRef<number | undefined>(undefined);
  const form = useForm<WalletFormValues>({
    resolver: (values, context, options) => zodResolver(walletSchema(exponentRef.current))(values, context, options),
    mode: "onChange",
    defaultValues: {
      name: wallet?.name ?? "",
      currency: wallet?.currency ?? defaultCurrency ?? "",
      opening_balance: wallet?.opening_balance ?? "0",
    },
  });
  const currency = form.watch("currency");
  const currencyList = currencies.data?.data ?? [];
  const exponent = currencyList.find((item) => item.code === currency)?.exponent;
  exponentRef.current = exponent;

  useEffect(() => {
    if (!wallet && !currency && defaultCurrency)
      form.setValue("currency", defaultCurrency, { shouldValidate: true });
  }, [currency, defaultCurrency, form, wallet]);

  // Currency precision is authoritative server data. Re-run the exact-string
  // validator whenever the selected currency's exponent changes so a prior
  // currency's precision cannot leak into submission.
  useEffect(() => {
    if (currencies.isPending || currencies.isError || exponent === undefined) return;
    void form.trigger();
  }, [currencies.isError, currencies.isPending, exponent, form, currency]);

  async function submit(values: WalletFormValues) {
    setStatus(undefined);
    try {
      if (wallet) {
        const data: { name?: string; opening_balance?: string } = {};
        if (form.formState.dirtyFields.name) data.name = values.name;
        if (form.formState.dirtyFields.opening_balance) data.opening_balance = values.opening_balance;
        if (Object.keys(data).length === 0) {
          setStatus({ kind: "error", text: "Change wallet name or opening balance before saving." });
          return;
        }
        const response = await update.mutateAsync({
          walletId: wallet.id,
          data,
        });
        setStatus({ kind: "success", text: "Wallet name saved." });
        onSuccess?.(response.data);
      } else {
        const response = await create.mutateAsync({ data: values });
        setStatus({ kind: "success", text: "Wallet created." });
        onSuccess?.(response.data);
        form.reset({ name: "", currency: values.currency, opening_balance: "0" });
      }
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  const pending = create.isPending || update.isPending;
  const precisionReady = !currencies.isPending && !currencies.isError && exponent !== undefined;
  return (
    <form
      className={`${embedded ? "" : "dialog "}wallet-form`}
      onSubmit={(event) => {
        void form.handleSubmit(submit)(event);
      }}
      noValidate
    >
      {showHeading ? <h2>{wallet ? "Edit wallet" : "Create wallet"}</h2> : null}
      <p className="muted">
        A wallet keeps one currency. Opening balance is starting wallet state, not a transaction.
      </p>
      <FormField
        label="Wallet name"
        htmlFor="wallet-name"
        error={form.formState.errors.name?.message}
      >
        <Input id="wallet-name" autoComplete="off" {...form.register("name")} />
      </FormField>
      <FormField
        label="Currency"
        htmlFor="wallet-currency"
        error={form.formState.errors.currency?.message}
      >
        <select
          id="wallet-currency"
          className="input"
          disabled={Boolean(wallet) || currencies.isPending}
          {...form.register("currency")}
        >
          <option value="">Choose currency</option>
          {currencyList.map((item) => (
            <option key={item.code} value={item.code}>
              {item.code} — {item.display_name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        label="Opening balance"
        htmlFor="wallet-opening-balance"
        error={form.formState.errors.opening_balance?.message}
      >
        <Input
          id="wallet-opening-balance"
          inputMode="decimal"
          {...form.register("opening_balance")}
        />
      </FormField>
      {wallet ? (
        <p className="muted" id="wallet-immutable-help">
          Currency cannot be changed. Opening balance changes wallet balance without adding history.
        </p>
      ) : null}
      {status ? (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={status.kind === "error" ? "field-error" : "success"}
        >
          {status.text}
        </p>
      ) : null}
      <Button type="submit" disabled={!form.formState.isValid || pending || !precisionReady}>
        {pending ? "Saving…" : (submitLabel ?? (wallet ? "Save wallet" : "Create wallet"))}
      </Button>
      {onCancel ? <Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button> : null}
    </form>
  );
}
