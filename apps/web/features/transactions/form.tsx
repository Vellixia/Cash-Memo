"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import {
  useCreateTransaction,
  useGetTransactionEntryDefaults,
  useListCategories,
  useListCurrencies,
  useListWallets,
  useUpdateTransaction,
} from "../../generated/api";
import type { TransactionContract } from "../../generated/api/model/transactionContract";
import type { CreateTransactionRequest } from "../../generated/api/model/createTransactionRequest";
import type { UpdateTransactionRequest } from "../../generated/api/model/updateTransactionRequest";
import { transactionSchema, type TransactionFormValues } from "../../lib/validation/transaction";
import { invalidateTransactionScopes } from "./query-keys";

type DateTimePart = "year" | "month" | "day" | "hour" | "minute";

/** Format canonical UTC instants as Cashmemo local wall-clock minutes. */
export function formatUtcForTimezone(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => ["year", "month", "day", "hour", "minute"].includes(type))
      .map(({ type, value: partValue }) => [type, partValue]),
  ) as Record<DateTimePart, string>;
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function formatCurrentLocalMinute(timeZone: string): string {
  return formatUtcForTimezone(new Date(), timeZone);
}

function errorText(error: unknown) {
  const value = error as {
    response?: { data?: { error?: { message?: string; fields?: Record<string, unknown> | null } } };
    message?: string;
  };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
}

function fieldErrorText(error: unknown, field: string): string | undefined {
  const value = error as {
    response?: { data?: { error?: { fields?: Record<string, unknown> | null } } };
  };
  const fieldValue = value.response?.data?.error?.fields?.[field];
  if (typeof fieldValue === "string") return fieldValue;
  if (Array.isArray(fieldValue) && typeof fieldValue[0] === "string") return fieldValue[0];
  if (fieldValue && typeof fieldValue === "object" && "message" in fieldValue) {
    const message = (fieldValue as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

export function TransactionForm({
  transaction,
  onSuccess,
}: {
  transaction?: TransactionContract;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const defaults = useGetTransactionEntryDefaults({ query: { retry: 1 } });
  const wallets = useListWallets({ query: { retry: 1 } });
  const currencies = useListCurrencies({ query: { retry: 1 } });
  const categories = useListCategories({ query: { retry: 1 } });
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const timezone = defaults.data?.data.timezone ?? "UTC";
  const walletRegistry = (wallets.data?.data ?? []).map(({ id, name, currency, archived_at }) => ({
    id,
    name,
    currency,
    archived_at: archived_at ?? null,
  }));
  const transactionWallet = transaction
    ? walletRegistry.find((wallet) => wallet.id === transaction.wallet_id) ?? {
        id: transaction.wallet_id,
        name: transaction.wallet_name,
        currency: transaction.currency,
        archived_at: "historical",
      }
    : undefined;
  const walletList = [
    ...(transactionWallet?.archived_at ? [transactionWallet] : []),
    ...walletRegistry.filter((wallet) => !wallet.archived_at),
  ];
  const currencyList = currencies.data?.data ?? [];
  const initialOccurredAt = transaction
    ? formatUtcForTimezone(transaction.occurred_at, timezone)
    : formatCurrentLocalMinute(timezone);
  const exponentRef = useRef<number | undefined>(undefined);
  const form = useForm<TransactionFormValues>({
    resolver: async (values, context, options) =>
      zodResolver(transactionSchema(exponentRef.current ?? 2))(values, context, options),
    mode: "onChange",
    defaultValues: {
      amount: transaction?.amount ?? "",
      wallet_id: transaction?.wallet_id ?? "",
      category_id: transaction?.category_id ?? "",
      direction: transaction?.direction === "income" ? "income" : "expense",
      note: transaction?.note ?? "",
      occurred_at: initialOccurredAt,
    },
  });
  const direction = form.watch("direction");
  const walletId = form.watch("wallet_id");
  const selectedWallet = walletList.find((wallet) => wallet.id === walletId);
  const exponent = currencyList.find((currency) => currency.code === selectedWallet?.currency)?.exponent;
  exponentRef.current = exponent;
  const categoryRegistry = categories.data?.data ?? [];
  const transactionCategory = transaction
    ? categoryRegistry.find((category) => category.id === transaction.category_id) ?? {
        id: transaction.category_id,
        name: transaction.category_name,
        kind: transaction.direction,
        archived_at: "historical",
      }
    : undefined;
  const categoryList = [
    ...(transactionCategory?.archived_at && transactionCategory.kind.toLowerCase() === direction
      ? [transactionCategory]
      : []),
    ...categoryRegistry.filter(
      (category) =>
        !category.archived_at &&
        category.kind.toLowerCase() === direction,
    ),
  ];
  const optionsPending =
    defaults.isPending || wallets.isPending || currencies.isPending || categories.isPending;
  const optionsError =
    defaults.isError || wallets.isError || currencies.isError || categories.isError;

  // Resolver depends on selected wallet currency precision. Keep exact amount text intact while
  // re-validating against newly selected wallet.
  useEffect(() => {
    exponentRef.current = exponent;
    if (walletId && exponent === undefined && !currencies.isPending) {
      form.setError("amount", {
        type: "currency",
        message: "Currency precision unavailable. Retry the currency registry.",
      });
    } else if (form.getFieldState("amount").error?.type === "currency") {
      form.clearErrors("amount");
      void form.trigger("amount");
    } else {
      void form.trigger("amount");
    }
  }, [currencies.isPending, exponent, form, walletId]);

  // Entry defaults arrive after first render. Rebase RHF's default when the
  // authoritative timezone changes, without overwriting a genuine user edit.
  useEffect(() => {
    if (form.getFieldState("occurred_at").isDirty) return;
    form.resetField("occurred_at", {
      defaultValue: transaction
        ? formatUtcForTimezone(transaction.occurred_at, timezone)
        : formatCurrentLocalMinute(timezone),
    });
    void form.trigger("occurred_at");
  }, [form, timezone, transaction]);

  useEffect(() => {
    if (transaction || form.getValues("wallet_id") || walletList.length === 0) return;
    const lastUsed = walletList.find(
      (wallet) => wallet.id === defaults.data?.data.last_used_wallet_id,
    );
    const fallback = walletList.length === 1 ? walletList[0] : lastUsed;
    if (fallback) form.setValue("wallet_id", fallback.id, { shouldValidate: true });
  }, [defaults.data?.data.last_used_wallet_id, form, transaction, walletList]);

  async function submit(values: TransactionFormValues) {
    setStatus(undefined);
    if (exponent === undefined) {
      form.setError("amount", {
        type: "currency",
        message: "Currency precision unavailable. Retry the currency registry.",
      });
      return;
    }
    const common = {
      amount: values.amount.trim(),
      direction: values.direction,
      note: values.note.trim() || null,
    };
    const occurredLocalChanged = form.formState.dirtyFields.occurred_at === true;
    const updateData: UpdateTransactionRequest = {
      ...common,
      ...(values.wallet_id !== transaction?.wallet_id ? { wallet_id: values.wallet_id } : {}),
      ...(values.category_id !== transaction?.category_id ? { category_id: values.category_id } : {}),
      ...(values.direction !== transaction?.direction ? { direction: values.direction } : {}),
      ...(occurredLocalChanged ? { occurred_local: values.occurred_at } : {}),
    };
    const createData: CreateTransactionRequest = {
      ...common,
      wallet_id: values.wallet_id,
      category_id: values.category_id,
      occurred_local: values.occurred_at,
    };
    try {
      if (transaction) {
        const response = await update.mutateAsync({ transactionId: transaction.id, data: updateData });
        await invalidateTransactionScopes(queryClient, {
          previous: transaction,
          next: { ...transaction, ...response.data },
          timezone,
        });
        setStatus({ kind: "success", text: "Transaction saved." });
      } else {
        const response = await create.mutateAsync({ data: createData });
        await invalidateTransactionScopes(queryClient, {
          next: {
            wallet_id: response.data.wallet_id,
            category_id: response.data.category_id,
            occurred_at: response.data.occurred_at,
          },
          timezone,
        });
        setStatus({ kind: "success", text: "Transaction saved." });
        form.reset({
          ...values,
          amount: "",
          note: "",
          occurred_at: formatCurrentLocalMinute(timezone),
        });
      }
      onSuccess?.();
    } catch (error) {
      const occurredLocalError = fieldErrorText(error, "occurred_local");
      if (occurredLocalError) {
        form.setError("occurred_at", { type: "server", message: occurredLocalError });
      }
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  const pending = create.isPending || update.isPending;
  const amountError = form.formState.errors.amount?.message;
  const directionError = form.formState.errors.direction?.message;
  const walletError = form.formState.errors.wallet_id?.message;
  const categoryError = form.formState.errors.category_id?.message;
  const occurredError = form.formState.errors.occurred_at?.message;
  const noteError = form.formState.errors.note?.message;
  const submitDisabled =
    pending || optionsPending || optionsError || exponent === undefined || !form.formState.isValid;

  return (
    <section className="management-page">
      <div className="page-heading">
        <div>
          <p className="muted">Manual money memo</p>
          <h1>{transaction ? "Edit transaction" : "New transaction"}</h1>
        </div>
      </div>
      <form
        className="dialog transaction-form"
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        noValidate
      >
        {optionsPending ? <p role="status">Loading transaction options…</p> : null}
        {optionsError ? (
          <div role="alert" className="field-error">
            <p>Could not load transaction options.</p>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                if (defaults.isError) void defaults.refetch();
                if (wallets.isError) void wallets.refetch();
                if (currencies.isError) void currencies.refetch();
                if (categories.isError) void categories.refetch();
              }}
            >
              Retry options
            </Button>
          </div>
        ) : null}
        <FormField label="Amount" htmlFor="transaction-amount" error={amountError}>
          <Input
            id="transaction-amount"
            className="transaction-amount"
            autoFocus
            inputMode="decimal"
            {...form.register("amount")}
          />
        </FormField>
        <div className="form-field">
          <label id="transaction-direction-label">Direction</label>
          <RadioGroup
            aria-labelledby="transaction-direction-label"
            value={direction}
            onValueChange={(value) => {
              form.setValue("direction", value as TransactionFormValues["direction"], {
                shouldDirty: true,
                shouldValidate: true,
              });
              form.setValue("category_id", "", { shouldDirty: true, shouldValidate: true });
            }}
            className="transaction-direction"
          >
            <label htmlFor="transaction-direction-expense">
              <RadioGroupItem id="transaction-direction-expense" value="expense" />
              Expense
            </label>
            <label htmlFor="transaction-direction-income">
              <RadioGroupItem id="transaction-direction-income" value="income" />
              Income
            </label>
          </RadioGroup>
          {directionError ? (
            <p className="field-error" id="transaction-direction-error" role="alert">
              {directionError}
            </p>
          ) : null}
        </div>
        <Controller
          control={form.control}
          name="wallet_id"
          render={({ field }) => (
            <div className="form-field">
              <label htmlFor="transaction-wallet">Wallet</label>
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={wallets.isPending}
              >
                <SelectTrigger
                  id="transaction-wallet"
                  className="min-h-11 w-full"
                  aria-describedby={walletError ? "transaction-wallet-error" : undefined}
                  aria-invalid={walletError ? true : undefined}
                  onBlur={field.onBlur}
                >
                  <span data-slot="select-value">
                    {selectedWallet ? `${selectedWallet.name} — ${selectedWallet.currency}` : "Choose wallet"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {walletList.map((wallet) => (
                    <SelectItem value={wallet.id} key={wallet.id} disabled={Boolean(wallet.archived_at)}>
                      {wallet.name} — {wallet.currency}
                      {wallet.archived_at ? " (archived)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {walletError ? (
                <p className="field-error" id="transaction-wallet-error" role="alert">
                  {walletError}
                </p>
              ) : null}
            </div>
          )}
        />
        <Controller
          control={form.control}
          name="category_id"
          render={({ field }) => (
            <div className="form-field">
              <label htmlFor="transaction-category">Category</label>
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={categories.isPending}
              >
                <SelectTrigger
                  id="transaction-category"
                  className="min-h-11 w-full"
                  aria-describedby={categoryError ? "transaction-category-error" : undefined}
                  aria-invalid={categoryError ? true : undefined}
                  onBlur={field.onBlur}
                >
                  <span data-slot="select-value">
                    {categoryList.find((category) => category.id === field.value)?.name ?? "Choose category"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {categoryList.map((category) => (
                    <SelectItem value={category.id} key={category.id} disabled={Boolean(category.archived_at)}>
                      {category.name}
                      {category.archived_at ? " (archived)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categoryError ? (
                <p className="field-error" id="transaction-category-error" role="alert">
                  {categoryError}
                </p>
              ) : null}
            </div>
          )}
        />
        <FormField label="Occurred at" htmlFor="transaction-occurred-at" error={occurredError}>
          <Input
            id="transaction-occurred-at"
            type="datetime-local"
            {...form.register("occurred_at")}
          />
        </FormField>
        <FormField label="Note" htmlFor="transaction-note" error={noteError}>
          <Textarea id="transaction-note" rows={3} {...form.register("note")} />
        </FormField>
        {status ? (
          <p
            role={status.kind === "error" ? "alert" : "status"}
            className={status.kind === "error" ? "field-error" : "success"}
          >
            {status.text}
          </p>
        ) : null}
        <div className="card-actions transaction-actions">
          <Button type="submit" disabled={submitDisabled}>
            {pending ? "Saving…" : "Save transaction"}
          </Button>
          <Link className="button quiet" href="/app/transactions">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
