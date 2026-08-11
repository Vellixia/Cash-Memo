import { useCallback, useEffect, useState } from "react";

import {
  JournalApiError,
  type CurrentMonthCurrency,
  type CurrentMonthOverviewView,
  type JournalApiPort,
  type OverviewBucket,
} from "../../app/journal-api.js";

interface CurrentMonthOverviewProps {
  readonly api: JournalApiPort;
}

type LoadState = "loading" | "populated" | "empty" | "unavailable" | "network-error";

function formatMinor(amountMinor: string, exponent: number): string {
  const negative = amountMinor.startsWith("-");
  const magnitude = negative ? amountMinor.slice(1) : amountMinor;
  const padded = magnitude.padStart(exponent + 1, "0");
  const value =
    exponent === 0
      ? padded
      : `${padded.slice(0, -exponent)}.${padded.slice(-exponent).padEnd(exponent, "0")}`;
  return negative ? `-${value}` : value;
}

function Breakdown({
  buckets,
  currency,
  exponent,
  title,
}: {
  readonly buckets: readonly OverviewBucket[];
  readonly currency: string;
  readonly exponent: number;
  readonly title: string;
}) {
  return (
    <section>
      <h4>{title}</h4>
      <ul>
        {buckets.map((bucket) => (
          <li key={bucket.key}>
            <span>{bucket.label}</span>{" "}
            <span>{`${currency} ${formatMinor(bucket.amountMinor, exponent)}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CurrencySection({ section }: { readonly section: CurrentMonthCurrency }) {
  const amount = (minor: string) =>
    `${section.currency} ${formatMinor(minor, section.currencyExponent)}`;
  return (
    <article data-testid={`current-month-currency-${section.currency}`}>
      <h3>{section.currency}</h3>
      <dl>
        <dt>Income</dt>
        <dd data-testid={`${section.currency}-income`}>{amount(section.incomeMinor)}</dd>
        <dt>Expenses</dt>
        <dd data-testid={`${section.currency}-expenses`}>{amount(section.expenseMinor)}</dd>
        <dt>Net movement</dt>
        <dd data-testid={`${section.currency}-net`}>{amount(section.netMinor)}</dd>
      </dl>
      <Breakdown
        buckets={section.categoryBreakdown}
        currency={section.currency}
        exponent={section.currencyExponent}
        title="Categories"
      />
      <Breakdown
        buckets={section.planningBreakdown}
        currency={section.currency}
        exponent={section.currencyExponent}
        title="Planning"
      />
      <Breakdown
        buckets={section.purposeBreakdown}
        currency={section.currency}
        exponent={section.currencyExponent}
        title="Purpose"
      />
    </article>
  );
}

function RecentMemos({ overview }: { readonly overview: CurrentMonthOverviewView }) {
  return (
    <section aria-labelledby="recent-active-title">
      <h3 id="recent-active-title">Recent active Money Memos</h3>
      {overview.recentMemos.length === 0 ? (
        <p>No recent active memos.</p>
      ) : (
        <ul data-testid="current-month-recent-memos">
          {overview.recentMemos.map((memo) => (
            <li key={memo.id}>
              <span>{memo.direction === "income" ? "Income" : "Expense"}</span>{" "}
              <span>
                {`${memo.money.currency} ${formatMinor(
                  memo.money.amountMinor,
                  memo.money.currencyExponent,
                )}`}
              </span>{" "}
              <time dateTime={memo.occurrence.occurredAt}>{memo.occurrence.occurredAt}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CurrentMonthOverview({ api }: CurrentMonthOverviewProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [overview, setOverview] = useState<CurrentMonthOverviewView | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setOverview(null);
    try {
      const next = await api.getCurrentMonth();
      setOverview(next);
      setState(next.currencies.length === 0 ? "empty" : "populated");
    } catch (error) {
      setOverview(null);
      setState(
        error instanceof JournalApiError && error.code === "CURRENT_MONTH_CALCULATION_UNAVAILABLE"
          ? "unavailable"
          : "network-error",
      );
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="current-month-title" data-testid="current-month-overview">
      <h2 id="current-month-title">Current month</h2>
      {state === "loading" && <p data-testid="current-month-loading">Loading overview…</p>}
      {state === "empty" && overview !== null && (
        <>
          <p data-testid="current-month-empty">No activity this month</p>
          <RecentMemos overview={overview} />
        </>
      )}
      {state === "unavailable" && (
        <div data-testid="current-month-unavailable">
          <p>Current-month calculation unavailable</p>
          <button type="button" onClick={() => void load()}>
            Retry overview
          </button>
        </div>
      )}
      {state === "network-error" && (
        <div data-testid="current-month-network-error">
          <p>Overview could not be loaded. Check your connection and try again.</p>
          <button type="button" onClick={() => void load()}>
            Retry overview
          </button>
        </div>
      )}
      {state === "populated" && overview !== null && (
        <>
          <p>
            Reporting month {overview.period} · {overview.reportingTimezone}
          </p>
          <div data-testid="current-month-currencies">
            {overview.currencies.map((section) => (
              <CurrencySection key={section.currency} section={section} />
            ))}
          </div>
          <RecentMemos overview={overview} />
        </>
      )}
    </section>
  );
}

export { formatMinor };
