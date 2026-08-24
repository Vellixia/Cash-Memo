"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BudgetContract } from "../../generated/api/model/budgetContract";
import { getGetBudgetSummaryQueryKey, getGetMonthlySummaryQueryKey, getListBudgetsQueryKey, useCreateBudget, useListCategories, useListCurrencies, useUpdateBudget } from "../../generated/api";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";

function requestError(error: unknown): string {
  const value = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return value.response?.data?.error?.message ?? value.message ?? "Could not save budget.";
}

export function BudgetForm({ initialMonth = "", budget, onSaved }: { initialMonth?: string; budget?: BudgetContract; onSaved?: () => void }) {
  const [month, setMonth] = useState(budget?.month ?? initialMonth);
  const [categoryId, setCategoryId] = useState(budget?.category_id ?? "");
  const [currency, setCurrency] = useState(budget?.currency ?? "");
  const [amount, setAmount] = useState(budget?.amount ?? "");
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const categories = useListCategories({ query: { retry: false } });
  const currencies = useListCurrencies({ query: { retry: false } });
  const create = useCreateBudget();
  const update = useUpdateBudget();
  const client = useQueryClient();
  const exponent = currencies.data?.data.find(item => item.code === currency)?.exponent;

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(undefined);
    if (!month || !categoryId || !currency || !amount.trim()) { setStatus({ kind: "error", text: "Complete every budget field." }); return; }
    const amountPattern = exponent === undefined ? /^\d+(?:\.\d+)?$/ : exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${String(exponent)}})?$`);
    if (!amountPattern.test(amount.trim())) { setStatus({ kind: "error", text: `Enter a non-negative amount with up to ${String(exponent ?? 0)} decimal places.` }); return; }
    try {
      if (budget) await update.mutateAsync({ budgetId: budget.id, data: { month, category_id: categoryId, currency, amount: amount.trim() } });
      else await create.mutateAsync({ data: { month, category_id: categoryId, currency, amount: amount.trim() } });
      const params = { month };
      await Promise.all([
        client.invalidateQueries({ queryKey: getListBudgetsQueryKey(params) }),
        client.invalidateQueries({ queryKey: getGetBudgetSummaryQueryKey(params) }),
        client.invalidateQueries({ queryKey: getGetMonthlySummaryQueryKey(params) }),
      ]);
      setStatus({ kind: "success", text: "Budget saved. Totals refreshed from Cashmemo." });
      onSaved?.();
    } catch (error) { setStatus({ kind: "error", text: requestError(error) }); }
  }

  return <form className="dialog budget-form" onSubmit={event => void submit(event)} noValidate><h2>{budget ? "Edit budget" : "New budget"}</h2><FormField label="Month" htmlFor="budget-month"><Input id="budget-month" type="month" value={month} onChange={event => { setMonth(event.target.value); }} required /></FormField><FormField label="Category" htmlFor="budget-category"><select id="budget-category" className="input" value={categoryId} onChange={event => { setCategoryId(event.target.value); }} required><option value="">Choose expense category</option>{categories.data?.data.filter(category => category.kind === "expense" && !category.archived_at).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></FormField><FormField label="Currency" htmlFor="budget-currency"><select id="budget-currency" className="input" value={currency} onChange={event => { setCurrency(event.target.value); }} required><option value="">Choose currency</option>{currencies.data?.data.map(item => <option key={item.code} value={item.code}>{item.code} — {item.display_name}</option>)}</select></FormField><FormField label="Budget amount" htmlFor="budget-amount"><Input id="budget-amount" inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); }} required /></FormField><p className="muted">Cashmemo validates month boundaries in your reporting timezone. Currency precision comes from its currency registry.</p><Button type="submit" disabled={create.isPending || update.isPending}>{budget ? "Save changes" : "Create budget"}</Button>{status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}</form>;
}
