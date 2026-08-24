"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";
import {
  useCreateTransaction,
  useGetTransactionEntryDefaults,
  useListCategories,
  useListCurrencies,
  useListWallets,
  useUpdateTransaction,
} from "../../generated/api";
import type { TransactionContract } from "../../generated/api/model/transactionContract";
import { transactionSchema, type TransactionFormValues } from "../../lib/validation/transaction";
import { invalidateTransactionScopes } from "./query-keys";

function localDateTime(value = new Date()) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function errorText(error: unknown) {
  const value = error as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
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
  const walletList = (wallets.data?.data ?? []).filter((wallet) => !wallet.archived_at);
  const currencyList = currencies.data?.data ?? [];
  const [walletForPrecision, setWalletForPrecision] = useState(transaction?.wallet_id ?? "");
  const selectedWallet = walletList.find((wallet) => wallet.id === walletForPrecision);
  const exponent =
    currencyList.find((currency) => currency.code === selectedWallet?.currency)?.exponent ?? 4;
  const resolver = useMemo(() => zodResolver(transactionSchema(exponent)), [exponent]);
  const form = useForm<TransactionFormValues>({
    resolver,
    mode: "onChange",
    defaultValues: {
      amount: transaction?.amount ?? "",
      wallet_id: transaction?.wallet_id ?? "",
      category_id: transaction?.category_id ?? "",
      direction: transaction?.direction === "income" ? "income" : "expense",
      note: transaction?.note ?? "",
      occurred_at: transaction ? localDateTime(new Date(transaction.occurred_at)) : localDateTime(),
    },
  });
  const direction = form.watch("direction");
  const walletId = form.watch("wallet_id");
  const categoryList = (categories.data?.data ?? []).filter(
    (category) => !category.archived_at && category.kind === direction,
  );

  useEffect(() => {
    setWalletForPrecision(walletId);
  }, [walletId]);

  useEffect(() => {
    void form.trigger("amount");
  }, [exponent, form, walletId]);

  useEffect(() => {
    if (transaction || form.getValues("wallet_id") || walletList.length === 0) return;
    const serverWallet = walletList.find(
      (wallet) => wallet.id === defaults.data?.data.last_used_wallet_id,
    );
    const fallback = serverWallet ?? (walletList.length === 1 ? walletList[0] : undefined);
    if (fallback) form.setValue("wallet_id", fallback.id, { shouldValidate: true });
  }, [defaults.data?.data.last_used_wallet_id, form, transaction, walletList]);

  async function submit(values: TransactionFormValues) {
    setStatus(undefined);
    const data = {
      amount: values.amount.trim(),
      wallet_id: values.wallet_id,
      category_id: values.category_id,
      direction: values.direction,
      note: values.note || null,
      occurred_at:
        transaction && values.occurred_at === localDateTime(new Date(transaction.occurred_at))
          ? transaction.occurred_at
          : new Date(values.occurred_at).toISOString(),
    };
    try {
      if (transaction) {
        await update.mutateAsync({ transactionId: transaction.id, data });
        await invalidateTransactionScopes(queryClient, {
          previous: transaction,
          next: { ...transaction, ...data },
        });
        setStatus({ kind: "success", text: "Transaction saved." });
      } else {
        await create.mutateAsync({ data });
        await invalidateTransactionScopes(queryClient, {
          next: {
            wallet_id: data.wallet_id,
            category_id: data.category_id,
            occurred_at: data.occurred_at,
          },
        });
        setStatus({ kind: "success", text: "Transaction saved." });
        form.reset({ ...values, amount: "", note: "", occurred_at: localDateTime() });
      }
      onSuccess?.();
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  const pending = create.isPending || update.isPending;
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
        <FormField
          label="Amount"
          htmlFor="transaction-amount"
          error={form.formState.errors.amount?.message}
        >
          <Input
            id="transaction-amount"
            autoFocus
            inputMode="decimal"
            {...form.register("amount")}
          />
        </FormField>
        <FormField
          label="Direction"
          htmlFor="transaction-direction"
          error={form.formState.errors.direction?.message}
        >
          <select
            id="transaction-direction"
            className="input"
            {...form.register("direction", {
              onChange: () => {
                form.setValue("category_id", "", { shouldValidate: true });
              },
            })}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </FormField>
        <FormField
          label="Wallet"
          htmlFor="transaction-wallet"
          error={form.formState.errors.wallet_id?.message}
        >
          <select
            id="transaction-wallet"
            className="input"
            disabled={wallets.isPending}
            {...form.register("wallet_id")}
          >
            <option value="">Choose wallet</option>
            {walletList.map((wallet) => (
              <option value={wallet.id} key={wallet.id}>
                {wallet.name} — {wallet.currency}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label="Category"
          htmlFor="transaction-category"
          error={form.formState.errors.category_id?.message}
        >
          <select
            id="transaction-category"
            className="input"
            disabled={categories.isPending}
            {...form.register("category_id")}
          >
            <option value="">Choose category</option>
            {categoryList.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label="Occurred at"
          htmlFor="transaction-occurred-at"
          error={form.formState.errors.occurred_at?.message}
        >
          <Input
            id="transaction-occurred-at"
            type="datetime-local"
            {...form.register("occurred_at")}
          />
        </FormField>
        <FormField
          label="Note"
          htmlFor="transaction-note"
          error={form.formState.errors.note?.message}
        >
          <textarea id="transaction-note" className="input" rows={3} {...form.register("note")} />
        </FormField>
        {status ? (
          <p
            role={status.kind === "error" ? "alert" : "status"}
            className={status.kind === "error" ? "field-error" : "success"}
          >
            {status.text}
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={
            pending ||
            wallets.isError ||
            categories.isError ||
            currencies.isPending ||
            currencies.isError
          }
        >
          {pending ? "Saving…" : transaction ? "Save transaction" : "Save transaction"}
        </Button>
      </form>
    </section>
  );
}
