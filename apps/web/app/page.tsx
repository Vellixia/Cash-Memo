"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  formatMoney,
  getMemos,
  getSummary,
  type Category,
  type Direction,
  type Memo,
  type Summary,
} from "@/lib/api";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function HomePage() {
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth());
  const [memos, setMemos] = useState<Memo[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newCatName, setNewCatName] = useState("");
  const [newCatDirection, setNewCatDirection] = useState<Direction>("expense");

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  function loadCategories() {
    api<Category[]>("/categories")
      .then(setCategories)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load categories"));
  }

  function loadMonth() {
    Promise.all([getMemos(month), getSummary(month)])
      .then(([m, s]) => {
        setMemos(m);
        setSummary(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load data"));
  }

  useEffect(loadCategories, []);
  useEffect(loadMonth, [month]);

  async function onLogout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  }

  async function onAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      await api<Category>("/categories", {
        method: "POST",
        body: JSON.stringify({ name: newCatName.trim(), direction: newCatDirection }),
      });
      setNewCatName("");
      loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add category");
    }
  }

  async function onDeleteCategory(id: string) {
    if (!confirm("Delete this category?")) return;
    try {
      await api(`/categories/${id}`, { method: "DELETE" });
      loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete category");
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Cash Memo</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="month" className="sr-only">
            Month
          </label>
          <input
            id="month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1"
          />
          <button onClick={onLogout} className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100">
            Log out
          </button>
        </div>
      </header>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="grid gap-3 sm:grid-cols-2">
        {summary?.totals.length ? (
          Object.entries(
            summary.totals.reduce<Record<string, { income: number; expense: number }>>((acc, t) => {
              acc[t.currency] ??= { income: 0, expense: 0 };
              acc[t.currency][t.direction] = t.total_minor;
              return acc;
            }, {}),
          ).map(([currency, { income, expense }]) => (
            <div key={currency} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 font-medium text-zinc-700">{currency}</h2>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Income</dt>
                  <dd className="text-green-700">{formatMoney(income, currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Expense</dt>
                  <dd className="text-red-700">{formatMoney(expense, currency)}</dd>
                </div>
                <div className="flex justify-between border-t border-zinc-100 pt-1 font-medium">
                  <dt>Net</dt>
                  <dd>{formatMoney(income - expense, currency)}</dd>
                </div>
              </dl>
            </div>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No memos yet this month.</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium text-zinc-700">Memos</h2>
          <Link href="/memos/new" className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">
            New memo
          </Link>
        </div>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white shadow-sm">
          {memos.map((m) => (
            <li key={m.id}>
              <Link href={`/memos/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-500">
                    {new Date(m.occurred_at).toLocaleString()}
                    {m.category_id && categoryById.get(m.category_id) ? ` · ${categoryById.get(m.category_id)}` : ""}
                  </p>
                  {m.note && <p className="truncate text-sm text-zinc-700">{m.note}</p>}
                </div>
                <span className={`shrink-0 font-medium ${m.direction === "income" ? "text-green-700" : "text-red-700"}`}>
                  {m.direction === "income" ? "+" : "-"}
                  {formatMoney(m.amount_minor, m.currency)}
                </span>
              </Link>
            </li>
          ))}
          {memos.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">No memos for this month.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-zinc-700">Categories</h2>
        <ul className="mb-3 space-y-1">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded border border-zinc-200 bg-white px-3 py-2 text-sm">
              <span>
                {c.name} <span className="text-zinc-400">({c.direction})</span>
              </span>
              <button onClick={() => onDeleteCategory(c.id)} className="text-red-600 hover:underline">
                Delete
              </button>
            </li>
          ))}
          {categories.length === 0 && <li className="text-sm text-zinc-500">No categories yet.</li>}
        </ul>
        <form onSubmit={onAddCategory} className="flex flex-wrap gap-2">
          <label htmlFor="newCatName" className="sr-only">
            Category name
          </label>
          <input
            id="newCatName"
            type="text"
            required
            placeholder="Category name"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            className="min-w-0 flex-1 rounded border border-zinc-300 px-3 py-2"
          />
          <label htmlFor="newCatDirection" className="sr-only">
            Direction
          </label>
          <select
            id="newCatDirection"
            value={newCatDirection}
            onChange={(e) => setNewCatDirection(e.target.value as Direction)}
            className="rounded border border-zinc-300 px-3 py-2"
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <button type="submit" className="rounded bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700">
            Add
          </button>
        </form>
      </section>
    </main>
  );
}
