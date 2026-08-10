import { useState, type SyntheticEvent } from "react";

export interface ManualMemoFormProps {
  onSubmit: (input: {
    direction: "income" | "expense";
    amount: string;
    currency: string;
    occurredAt: string;
    occurredLocal: string;
    occurredTimezone: string;
    occurredOffsetMinutes: number;
    categoryId: string | null;
    moneySpaceId: string | null;
    purpose: "personal" | "work" | "mixed" | null;
    planningStatus: "planned" | "unplanned" | null;
    note: string | null;
  }) => Promise<void>;
  defaultCurrency?: string;
  categories?: readonly { id: string; kind: string; name: string }[];
}

export function ManualMemoForm({
  onSubmit,
  defaultCurrency = "USD",
  categories = [],
}: ManualMemoFormProps) {
  const [direction, setDirection] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 19));
  const [timezone, setTimezone] = useState("UTC");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<"personal" | "work" | "mixed" | null>(null);
  const [planningStatus, setPlanningStatus] = useState<"planned" | "unplanned" | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const now = new Date(occurredAt);
    const offset = -now.getTimezoneOffset();
    void onSubmit({
      amount,
      categoryId,
      currency,
      direction,
      occurredAt: now.toISOString(),
      occurredLocal: occurredAt,
      occurredOffsetMinutes: offset,
      occurredTimezone: timezone,
      moneySpaceId: null,
      note: note || null,
      planningStatus,
      purpose,
    })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "SUBMISSION_FAILED");
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <form data-testid="manual-memo-form" onSubmit={handleSubmit}>
      <div>
        <label>
          <input
            type="radio"
            name="direction"
            value="expense"
            checked={direction === "expense"}
            onChange={() => setDirection("expense")}
          />
          Expense
        </label>
        <label>
          <input
            type="radio"
            name="direction"
            value="income"
            checked={direction === "income"}
            onChange={() => setDirection("income")}
          />
          Income
        </label>
      </div>

      <label htmlFor="amount">Amount</label>
      <input
        id="amount"
        data-testid="amount"
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
        placeholder="0.00"
      />

      <label htmlFor="currency">Currency</label>
      <select
        id="currency"
        data-testid="currency"
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
      >
        <option value="USD">USD</option>
        <option value="IDR">IDR</option>
        <option value="EUR">EUR</option>
        <option value="GBP">GBP</option>
        <option value="JPY">JPY</option>
      </select>

      <label htmlFor="occurred-at">Date & Time</label>
      <input
        id="occurred-at"
        data-testid="occurred-at"
        type="datetime-local"
        value={occurredAt}
        onChange={(e) => setOccurredAt(e.target.value)}
        required
      />

      <label htmlFor="timezone">Timezone</label>
      <select
        id="timezone"
        data-testid="timezone"
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
      >
        <option value="UTC">UTC</option>
        <option value="Asia/Jakarta">Asia/Jakarta</option>
        <option value="Asia/Tokyo">Asia/Tokyo</option>
        <option value="America/New_York">America/New_York</option>
        <option value="Europe/London">Europe/London</option>
      </select>

      {categories.length > 0 && (
        <>
          <label htmlFor="category">Category</label>
          <select
            id="category"
            data-testid="category"
            value={categoryId ?? ""}
            onChange={(e) => setCategoryId(e.target.value || null)}
          >
            <option value="">None</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </>
      )}

      <label htmlFor="purpose">Purpose</label>
      <select
        id="purpose"
        data-testid="purpose"
        value={purpose ?? ""}
        onChange={(e) =>
          setPurpose((e.target.value || null) as "personal" | "work" | "mixed" | null)
        }
      >
        <option value="">None</option>
        <option value="personal">Personal</option>
        <option value="work">Work</option>
        <option value="mixed">Mixed</option>
      </select>

      <label htmlFor="planning">Planning</label>
      <select
        id="planning"
        data-testid="planning-status"
        value={planningStatus ?? ""}
        onChange={(e) =>
          setPlanningStatus((e.target.value || null) as "planned" | "unplanned" | null)
        }
      >
        <option value="">None</option>
        <option value="planned">Planned</option>
        <option value="unplanned">Unplanned</option>
      </select>

      <label htmlFor="note">Note</label>
      <textarea
        id="note"
        data-testid="note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={4000}
      />

      {error && <div data-testid="memo-form-error">{error}</div>}

      <button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : "Confirm memo"}
      </button>
    </form>
  );
}
