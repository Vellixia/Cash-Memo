"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import {
  useCreateWallet,
  useListCurrencies,
  useUpdateWallet,
} from "../../generated/api";
import type { WalletContract } from "../../generated/api/model/walletContract";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";
import { walletSchema, type WalletFormValues } from "../../lib/validation/wallet";

function errorText(error: unknown): string {
  const value = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
}

export function WalletForm({
  wallet,
  defaultCurrency,
  submitLabel,
  onSuccess,
}: {
  wallet?: WalletContract;
  defaultCurrency?: string;
  submitLabel?: string;
  onSuccess?: (wallet: WalletContract) => void;
}) {
  const currencies = useListCurrencies({ query: { retry: 1 } });
  const create = useCreateWallet();
  const update = useUpdateWallet();
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const form = useForm<WalletFormValues>({
    resolver: zodResolver(walletSchema),
    mode: "onChange",
    defaultValues: {
      name: wallet?.name ?? "",
      currency: wallet?.currency ?? defaultCurrency ?? "",
      opening_balance: wallet?.opening_balance ?? "0",
    },
  });
  const currency = form.watch("currency");
  const currencyList = currencies.data?.data ?? [];

  useEffect(() => {
    if (!wallet && !currency && defaultCurrency) form.setValue("currency", defaultCurrency, { shouldValidate: true });
  }, [currency, defaultCurrency, form, wallet]);

  async function submit(values: WalletFormValues) {
    setStatus(undefined);
    try {
      if (wallet) {
        const response = await update.mutateAsync({ walletId: wallet.id, data: { name: values.name } });
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
  return (
    <form className="dialog wallet-form" onSubmit={(event) => { void form.handleSubmit(submit)(event); }} noValidate>
      <h2>{wallet ? "Edit wallet" : "Create wallet"}</h2>
      <p className="muted">A wallet keeps one currency. Opening balance is starting wallet state, not a transaction.</p>
      <FormField label="Wallet name" htmlFor="wallet-name" error={form.formState.errors.name?.message}>
        <Input id="wallet-name" autoComplete="off" maxLength={80} {...form.register("name")} />
      </FormField>
      <FormField label="Currency" htmlFor="wallet-currency" error={form.formState.errors.currency?.message}>
        <select id="wallet-currency" className="input" disabled={Boolean(wallet) || currencies.isPending} {...form.register("currency")}>
          <option value="">Choose currency</option>
          {currencyList.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.display_name}</option>)}
        </select>
      </FormField>
      <FormField label="Opening balance" htmlFor="wallet-opening-balance" error={form.formState.errors.opening_balance?.message}>
        <Input id="wallet-opening-balance" inputMode="decimal" disabled={Boolean(wallet)} {...form.register("opening_balance")} />
      </FormField>
      {wallet ? <p className="muted" id="wallet-immutable-help">Currency and opening balance cannot be changed. Create another wallet if currency is wrong.</p> : null}
      {status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}
      <Button type="submit" disabled={!form.formState.isValid || pending || currencies.isError}>{pending ? "Saving…" : submitLabel ?? (wallet ? "Save wallet" : "Create wallet")}</Button>
    </form>
  );
}
