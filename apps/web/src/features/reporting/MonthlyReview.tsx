import { useCallback, useEffect, useState } from "react";

import {
  JournalApiError,
  type JournalApiPort,
  type MonthlyReviewCurrency,
  type MonthlyReviewView,
} from "../../app/journal-api.js";
import { formatMinor } from "./CurrentMonthOverview.js";

interface MonthlyReviewProps {
  readonly api: JournalApiPort;
  readonly initialMonth?: string;
}

type LoadState = "empty" | "loading" | "network-error" | "populated" | "unavailable";

function defaultMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function CurrencyReview({ section }: { readonly section: MonthlyReviewCurrency }) {
  const amount = (minor: string) =>
    `${section.currency} ${formatMinor(minor, section.currencyExponent)}`;
  return (
    <article data-testid={`monthly-review-currency-${section.currency}`}>
      <h3>{section.currency}</h3>
      <dl>
        <dt>Income</dt>
        <dd data-testid={`monthly-${section.currency}-income`}>{amount(section.incomeMinor)}</dd>
        <dt>Expenses</dt>
        <dd data-testid={`monthly-${section.currency}-expenses`}>{amount(section.expenseMinor)}</dd>
        <dt>Net movement</dt>
        <dd data-testid={`monthly-${section.currency}-net`}>{amount(section.netMinor)}</dd>
        <dt>Unplanned expenses</dt>
        <dd data-testid={`monthly-${section.currency}-unplanned`}>
          {amount(section.unplannedExpenseMinor)}
        </dd>
        <dt>Prior-month expenses</dt>
        <dd>{amount(section.priorMonth.expenseMinor)}</dd>
        <dt>Absolute expense change</dt>
        <dd data-testid={`monthly-${section.currency}-absolute-change`}>
          {amount(section.priorMonth.absoluteChangeMinor)}
        </dd>
      </dl>
      {section.priorMonth.percentageUnavailableReason === "PRIOR_VALUE_ZERO" ? (
        <p data-testid={`monthly-${section.currency}-prior-zero`}>
          Percentage comparison unavailable because prior-month expenses were zero.
        </p>
      ) : (
        <p data-testid={`monthly-${section.currency}-percentage`}>
          Expense change: {section.priorMonth.percentageChange}%
        </p>
      )}
      <section>
        <h4>Largest expense categories</h4>
        {section.largestExpenseCategories.length === 0 ? (
          <p>No expense categories this month.</p>
        ) : (
          <ol data-testid={`monthly-${section.currency}-categories`}>
            {section.largestExpenseCategories.map((bucket) => (
              <li key={bucket.key}>
                <span>{bucket.label}</span> <span>{amount(bucket.amountMinor)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}

export function MonthlyReview({ api, initialMonth = defaultMonth() }: MonthlyReviewProps) {
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [requestedMonth, setRequestedMonth] = useState(initialMonth);
  const [review, setReview] = useState<MonthlyReviewView | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback(
    async (month: string) => {
      setState("loading");
      setReview(null);
      try {
        const next = await api.getMonthlyReview(month);
        setReview(next);
        setState(next.currencies.length === 0 ? "empty" : "populated");
      } catch (error) {
        setReview(null);
        setState(
          error instanceof JournalApiError &&
            error.code === "MONTHLY_REVIEW_CALCULATION_UNAVAILABLE"
            ? "unavailable"
            : "network-error",
        );
      }
    },
    [api],
  );

  useEffect(() => {
    void load(requestedMonth);
  }, [load, requestedMonth]);

  return (
    <section aria-labelledby="monthly-review-title" data-testid="monthly-review">
      <h2 id="monthly-review-title">Monthly review</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setRequestedMonth(selectedMonth);
          if (selectedMonth === requestedMonth) void load(selectedMonth);
        }}
      >
        <label htmlFor="monthly-review-month">Calendar month</label>
        <input
          id="monthly-review-month"
          max="9999-12"
          min="0001-01"
          onChange={(event) => setSelectedMonth(event.currentTarget.value)}
          required
          type="month"
          value={selectedMonth}
        />
        <button type="submit">Review month</button>
      </form>
      {state === "loading" && <p data-testid="monthly-review-loading">Loading review…</p>}
      {state === "empty" && review !== null && (
        <p data-testid="monthly-review-empty">No activity in this month</p>
      )}
      {state === "unavailable" && (
        <div data-testid="monthly-review-unavailable">
          <p>Monthly review calculation unavailable</p>
          <button type="button" onClick={() => void load(requestedMonth)}>
            Retry monthly review
          </button>
        </div>
      )}
      {state === "network-error" && (
        <div data-testid="monthly-review-network-error">
          <p>Monthly review could not be loaded. Check your connection and try again.</p>
          <button type="button" onClick={() => void load(requestedMonth)}>
            Retry monthly review
          </button>
        </div>
      )}
      {state === "populated" && review !== null && (
        <>
          <p>
            {review.month} compared with {review.priorMonth} · {review.reportingTimezone}
          </p>
          <div data-testid="monthly-review-currencies">
            {review.currencies.map((section) => (
              <CurrencyReview key={section.currency} section={section} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
