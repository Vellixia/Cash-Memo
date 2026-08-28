"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RecurringTransaction } from "../../generated/api/model/recurringTransaction";
import {
  getListRecurringTransactionsQueryKey,
  useCreateRecurringTransaction,
  useListCategories,
  useListCurrencies,
  useListWallets,
  useUpdateRecurringTransaction,
} from "../../generated/api";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

const frequencies = ["daily", "weekly", "monthly", "yearly"] as const;
type Frequency = (typeof frequencies)[number];
function isFrequency(value: string): value is Frequency {
  return frequencies.includes(value as Frequency);
}

export function RecurringForm({
  recurring,
  embedded = false,
  onSaved,
  onCancel,
}: {
  recurring?: RecurringTransaction;
  embedded?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [walletId, setWalletId] = useState(recurring?.wallet_id ?? "");
  const [categoryId, setCategoryId] = useState(recurring?.category_id ?? "");
  const [direction, setDirection] = useState(recurring?.direction ?? "expense");
  const [amount, setAmount] = useState(recurring?.amount ?? "");
  const [frequency, setFrequency] = useState(recurring?.frequency ?? "monthly");
  const [startDate, setStartDate] = useState(recurring?.start_date ?? "");
  const [note, setNote] = useState(recurring?.note ?? "");
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const wallets = useListWallets({ query: { retry: false } });
  const categories = useListCategories({ query: { retry: false } });
  const currencies = useListCurrencies({ query: { retry: false } });
  const create = useCreateRecurringTransaction();
  const update = useUpdateRecurringTransaction();
  const client = useQueryClient();
  const wallet = wallets.data?.data.find((item) => item.id === walletId);
  const exponent = currencies.data?.data.find((item) => item.code === wallet?.currency)?.exponent;

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(undefined);
    const errors: Record<string, string> = {};
    if (!walletId) errors.wallet = "Choose a wallet.";
    if (!categoryId) errors.category = "Choose a category.";
    if (!amount.trim()) errors.amount = "Enter an amount.";
    if (!startDate) errors.startDate = "Choose a start date.";
    if (walletId && amount.trim() && exponent === undefined)
      errors.amount = "Currency precision is unavailable. Retry the currency registry.";
    else if (amount.trim() && exponent !== undefined) {
      const pattern =
        exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${String(exponent)}})?$`);
      if (!pattern.test(amount.trim()))
        errors.amount = `Amount allows up to ${String(exponent)} decimal places for ${wallet?.currency ?? "this currency"}.`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const data = {
      wallet_id: walletId,
      category_id: categoryId,
      direction,
      amount: amount.trim(),
      frequency,
      start_date: startDate,
      note: note.trim() || null,
    };
    try {
      if (recurring) await update.mutateAsync({ id: recurring.id, data });
      else await create.mutateAsync({ data });
      await client.invalidateQueries({ queryKey: getListRecurringTransactionsQueryKey() });
      setStatus({ kind: "success", text: "Recurring rule saved." });
      onSaved?.();
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not save recurring rule.",
      });
    }
  }

  if (wallets.isPending || categories.isPending || currencies.isPending)
    return (
      <div className="dialog" role="status">
        Loading recurring options…
      </div>
    );
  if (wallets.isError || categories.isError || currencies.isError)
    return (
      <div className="dialog">
        <p role="alert">Could not load recurring options.</p>
        <Button
          type="button"
          onClick={() => {
            if (wallets.isError) void wallets.refetch();
            if (categories.isError) void categories.refetch();
            if (currencies.isError) void currencies.refetch();
          }}
        >
          Retry recurring options
        </Button>
      </div>
    );

  return (
    <form
      className={`${embedded ? "" : "dialog "}recurring-form`}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      {!embedded ? <h2>{recurring ? "Edit recurring rule" : "New recurring rule"}</h2> : null}
      <p className="muted">
        Cashmemo server calculates the next due date from your timezone and cadence. Upcoming rules
        are not transactions.
      </p>
      {recurring ? (
        <p className="notice">
          Changes apply to future scheduled occurrences only. Existing generated transactions stay
          unchanged. Paused periods generate no occurrences; resume starts on the first cadence date
          on or after resume with no backfill.
        </p>
      ) : null}
      <FormField label="Wallet" htmlFor="recurring-wallet" error={fieldErrors.wallet}>
        <Select
          value={walletId}
          onValueChange={(value) => {
            if (value !== null) setWalletId(value);
          }}
        >
          <SelectTrigger
            id="recurring-wallet"
            aria-invalid={Boolean(fieldErrors.wallet)}
            aria-describedby={fieldErrors.wallet ? "recurring-wallet-error" : undefined}
            className="w-full"
          >
            <SelectValue placeholder="Choose wallet" />
          </SelectTrigger>
          <SelectContent>
            {wallets.data.data
              .filter((item) => !item.archived_at)
              .map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} — {item.currency}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Category" htmlFor="recurring-category" error={fieldErrors.category}>
        <Select
          value={categoryId}
          onValueChange={(value) => {
            if (value !== null) setCategoryId(value);
          }}
        >
          <SelectTrigger
            id="recurring-category"
            aria-invalid={Boolean(fieldErrors.category)}
            aria-describedby={fieldErrors.category ? "recurring-category-error" : undefined}
            className="w-full"
          >
            <SelectValue placeholder="Choose category" />
          </SelectTrigger>
          <SelectContent>
            {categories.data.data
              .filter((item) => !item.archived_at)
              .map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Direction" htmlFor="recurring-direction">
        <Select
          value={direction}
          onValueChange={(value) => {
            if (value === "expense" || value === "income") setDirection(value);
          }}
        >
          <SelectTrigger id="recurring-direction" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="expense">Expense</SelectItem>
            <SelectItem value="income">Income</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Amount" htmlFor="recurring-amount" error={fieldErrors.amount}>
        <Input
          id="recurring-amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </FormField>
      <FormField label="Frequency" htmlFor="recurring-frequency">
        <Select
          value={frequency}
          onValueChange={(value) => {
            if (value !== null && isFrequency(value)) setFrequency(value);
          }}
        >
          <SelectTrigger id="recurring-frequency" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {frequencies.map((value) => (
              <SelectItem key={value} value={value}>
                {value[0].toUpperCase()}
                {value.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Start date" htmlFor="recurring-start" error={fieldErrors.startDate}>
        <Input
          id="recurring-start"
          type="date"
          value={startDate}
          onChange={(event) => {
            setStartDate(event.target.value);
          }}
        />
      </FormField>
      <FormField label="Note" htmlFor="recurring-note">
        <Input
          id="recurring-note"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </FormField>
      <div className="card-actions">
        <Button type="submit" disabled={create.isPending || update.isPending}>
          {recurring ? "Save changes" : "Create recurring rule"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
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
