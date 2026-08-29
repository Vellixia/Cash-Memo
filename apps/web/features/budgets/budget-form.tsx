"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BudgetContract } from "../../generated/api/model/budgetContract";
import {
  useCreateBudget,
  useListCategories,
  useListCurrencies,
  useUpdateBudget,
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
import { invalidateBudgetQueries } from "./invalidate-budget-queries";

function requestError(error: unknown): string {
  const value = error as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return value.response?.data?.error?.message ?? value.message ?? "Could not save budget.";
}

export function BudgetForm({
  initialMonth = "",
  budget,
  embedded = false,
  onSaved,
}: {
  initialMonth?: string;
  budget?: BudgetContract;
  embedded?: boolean;
  onSaved?: () => void;
}) {
  const [month, setMonth] = useState(budget?.month ?? initialMonth);
  const [categoryId, setCategoryId] = useState(budget?.category_id ?? "");
  const [currency, setCurrency] = useState(budget?.currency ?? "");
  const [amount, setAmount] = useState(budget?.amount ?? "");
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const categories = useListCategories({ query: { retry: false } });
  const currencies = useListCurrencies({ query: { retry: false } });
  const create = useCreateBudget();
  const update = useUpdateBudget();
  const client = useQueryClient();
  const exponent = currencies.data?.data.find((item) => item.code === currency)?.exponent;
  const selectedCategory = categories.data?.data.find((category) => category.id === categoryId);
  const selectedCurrency = currencies.data?.data.find((item) => item.code === currency);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(undefined);
    const errors: Record<string, string> = {};
    if (!month) errors.month = "Choose a budget month.";
    if (!categoryId) errors.category = "Choose an expense category.";
    if (!currency) errors.currency = "Choose a currency.";
    if (!amount.trim()) errors.amount = "Enter a budget amount.";
    else if (currency && exponent === undefined)
      errors.amount = "Currency precision is unavailable. Retry the currency registry.";
    else if (exponent !== undefined) {
      const amountPattern =
        exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${String(exponent)}})?$`);
      if (!amountPattern.test(amount.trim()))
        errors.amount = `Enter a non-negative amount with up to ${String(exponent)} decimal places.`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    try {
      if (budget) {
        const data = {
          month,
          currency,
          amount: amount.trim(),
          ...(categoryId !== budget.category_id ? { category_id: categoryId } : {}),
        };
        await update.mutateAsync({
          budgetId: budget.id,
          data,
        });
      } else {
        await create.mutateAsync({
          data: { month, category_id: categoryId, currency, amount: amount.trim() },
        });
      }
      await invalidateBudgetQueries(client, budget ? [budget.month, month] : [month]);
      setStatus({ kind: "success", text: "Budget saved. Totals refreshed from Cashmemo." });
      onSaved?.();
    } catch (error) {
      setStatus({ kind: "error", text: requestError(error) });
    }
  }

  if (categories.isPending || currencies.isPending)
    return (
      <div className="dialog" role="status">
        Loading budget options…
      </div>
    );
  if (categories.isError || currencies.isError)
    return (
      <div className="dialog">
        <p role="alert">Could not load budget options.</p>
        <Button
          type="button"
          onClick={() => {
            if (categories.isError) void categories.refetch();
            if (currencies.isError) void currencies.refetch();
          }}
        >
          {currencies.isError && !categories.isError
            ? "Retry currency registry"
            : "Retry budget options"}
        </Button>
      </div>
    );

  return (
    <form
      className={`${embedded ? "" : "dialog "}budget-form`}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      {!embedded ? <h2>{budget ? "Edit budget" : "New budget"}</h2> : null}
      <FormField label="Month" htmlFor="budget-month" error={fieldErrors.month}>
        <Input
          id="budget-month"
          type="month"
          value={month}
          onChange={(event) => {
            setMonth(event.target.value);
          }}
          required
        />
      </FormField>
      <FormField label="Category" htmlFor="budget-category" error={fieldErrors.category}>
        <Select
          value={categoryId}
          onValueChange={(value) => {
            if (value !== null) setCategoryId(value);
          }}
        >
          <SelectTrigger
            id="budget-category"
            aria-invalid={Boolean(fieldErrors.category)}
            aria-describedby={fieldErrors.category ? "budget-category-error" : undefined}
            className="w-full"
          >
            <SelectValue placeholder="Choose expense category">
              {selectedCategory
                ? `${selectedCategory.name}${selectedCategory.archived_at ? " (archived historical category)" : ""}`
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {categories.data.data
              .filter(
                (category) =>
                  category.kind === "expense" &&
                  (!category.archived_at || category.id === budget?.category_id),
              )
              .map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                  {category.archived_at ? " (archived historical category)" : ""}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </FormField>
      {budget && selectedCategory?.archived_at ? (
        <p className="muted">Archived category retained for historical budget reference.</p>
      ) : null}
      <FormField label="Currency" htmlFor="budget-currency" error={fieldErrors.currency}>
        <Select
          value={currency}
          onValueChange={(value) => {
            if (value !== null) setCurrency(value);
          }}
        >
          <SelectTrigger
            id="budget-currency"
            aria-invalid={Boolean(fieldErrors.currency)}
            aria-describedby={fieldErrors.currency ? "budget-currency-error" : undefined}
            className="w-full"
          >
            <SelectValue placeholder="Choose currency">
              {selectedCurrency ? `${selectedCurrency.code} — ${selectedCurrency.display_name}` : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {currencies.data.data.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {item.code} — {item.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Budget amount" htmlFor="budget-amount" error={fieldErrors.amount}>
        <Input
          id="budget-amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
          required
        />
      </FormField>
      <p className="muted">
        Cashmemo validates month boundaries in your reporting timezone. Currency precision comes
        from its currency registry.
      </p>
      <Button type="submit" disabled={create.isPending || update.isPending}>
        {budget ? "Save changes" : "Create budget"}
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
