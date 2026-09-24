"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fromMinor, toMinor, type Category, type Direction, type Memo } from "@/lib/api";

const LAST_CURRENCY_KEY = "cashmemo:lastCurrency";

function readLastCurrency(): string {
  try {
    return localStorage.getItem(LAST_CURRENCY_KEY) ?? "USD";
  } catch {
    return "USD";
  }
}

function writeLastCurrency(currency: string) {
  try {
    localStorage.setItem(LAST_CURRENCY_KEY, currency);
  } catch {
    // ignore (private mode, blocked storage, etc.)
  }
}

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default function MemoForm({ memo }: { memo?: Memo }) {
  const router = useRouter();
  const isEdit = !!memo;

  const [direction, setDirection] = useState<Direction>(memo?.direction ?? "expense");
  const [amount, setAmount] = useState(memo ? fromMinor(memo.amount_minor, memo.currency) : "");
  const [currency, setCurrency] = useState(() => memo?.currency ?? readLastCurrency());
  const [occurredAt, setOccurredAt] = useState(
    memo ? toDatetimeLocal(new Date(memo.occurred_at)) : toDatetimeLocal(new Date()),
  );
  const [categoryId, setCategoryId] = useState(memo?.category_id ?? "");
  const [note, setNote] = useState(memo?.note ?? "");
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Category[]>("/categories")
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const filteredCategories = categories.filter((c) => c.direction === direction);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalizedCurrency = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      setError("Currency must be 3 letters (e.g. USD)");
      return;
    }

    setSaving(true);
    try {
      const body = {
        direction,
        amount_minor: toMinor(amount, normalizedCurrency),
        currency: normalizedCurrency,
        occurred_at: new Date(occurredAt).toISOString(),
        category_id: categoryId || null,
        note: note || null,
      };

      if (isEdit) {
        await api<Memo>(`/memos/${memo.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api<Memo>("/memos", { method: "POST", body: JSON.stringify(body) });
      }
      writeLastCurrency(normalizedCurrency);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save memo");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!memo) return;
    if (!confirm("Delete this memo?")) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/memos/${memo.id}`, { method: "DELETE" });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete memo");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">{isEdit ? "Edit memo" : "New memo"}</h1>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <fieldset className="flex gap-2">
        <legend className="mb-1 block text-sm font-medium">Direction</legend>
        {(["expense", "income"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={`flex-1 rounded border px-3 py-2 capitalize ${
              direction === d
                ? d === "income"
                  ? "border-green-600 bg-green-50 text-green-700"
                  : "border-red-600 bg-red-50 text-red-700"
                : "border-zinc-300 text-zinc-600"
            }`}
          >
            {d}
          </button>
        ))}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="amount" className="mb-1 block text-sm font-medium">
            Amount
          </label>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            required
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 focus:border-zinc-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="currency" className="mb-1 block text-sm font-medium">
            Currency
          </label>
          <input
            id="currency"
            type="text"
            required
            maxLength={3}
            placeholder="USD"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="w-full rounded border border-zinc-300 px-3 py-2 uppercase focus:border-zinc-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label htmlFor="occurred_at" className="mb-1 block text-sm font-medium">
          Date &amp; time
        </label>
        <input
          id="occurred_at"
          type="datetime-local"
          required
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="category" className="mb-1 block text-sm font-medium">
          Category
        </label>
        <select
          id="category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2 focus:border-zinc-500 focus:outline-none"
        >
          <option value="">No category</option>
          {filteredCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="note" className="mb-1 block text-sm font-medium">
          Note
        </label>
        <textarea
          id="note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded bg-zinc-900 px-3 py-2 text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {isEdit && (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="rounded border border-red-300 px-3 py-2 text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
