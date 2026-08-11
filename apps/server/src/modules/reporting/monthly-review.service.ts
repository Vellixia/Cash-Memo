import {
  calculateMonthlyReview,
  previousReportingMonth,
  reportingMonthBounds,
  type MonthlyCurrencyReview,
  type MonthlyReviewCandidate,
} from "@cashmemo/domain";

import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";

interface MonthlyReviewView {
  readonly calculatedAt: string;
  readonly currencies: readonly MonthlyCurrencyReview[];
  readonly month: string;
  readonly priorMonth: string;
  readonly reportingTimezone: string;
}

interface MonthlyReviewServiceOptions {
  readonly now?: () => Date;
  readonly pool: Pool;
}

interface MonthlyReviewRow {
  readonly amount_minor: string;
  readonly category_id: string | null;
  readonly category_name: string | null;
  readonly category_normalized_name: string | null;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly direction: "expense" | "income";
  readonly lifecycle_state: "active" | "archived";
  readonly money_space_id: string | null;
  readonly occurred_at: string;
  readonly planning_status: "planned" | "unplanned" | null;
  readonly purpose: "mixed" | "personal" | "work" | null;
}

class MonthlyReviewUnavailableError extends Error {
  readonly code = "MONTHLY_REVIEW_CALCULATION_UNAVAILABLE";

  constructor() {
    super("Monthly review calculation unavailable.");
    this.name = "MonthlyReviewUnavailableError";
  }
}

const UTC_INSTANT_SQL = `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"`;

class MonthlyReviewService {
  private readonly now: () => Date;
  private readonly pool: Pool;

  constructor(options: Readonly<MonthlyReviewServiceOptions>) {
    this.pool = options.pool;
    this.now = options.now ?? (() => new Date());
  }

  async getMonthlyReview(accountId: string, month: string): Promise<MonthlyReviewView> {
    const calculatedAt = this.now().toISOString();
    try {
      return await withAccountTransaction(this.pool, accountId, async (transaction) => {
        const preferenceResult = await transaction.query<{ reporting_timezone: string }>(
          `SELECT reporting_timezone FROM preferences WHERE user_id = $1`,
          [accountId],
        );
        const reportingTimezone = preferenceResult.rows[0]?.reporting_timezone;
        if (reportingTimezone === undefined) throw new MonthlyReviewUnavailableError();
        const priorMonth = previousReportingMonth(month);
        const selectedBounds = reportingMonthBounds({ month, reportingTimezone });
        const priorBounds = reportingMonthBounds({ month: priorMonth, reportingTimezone });
        const result = await transaction.query<MonthlyReviewRow>(
          `SELECT
             m.amount_minor::text,
             m.category_id,
             c.name AS category_name,
             c.normalized_name AS category_normalized_name,
             m.currency_code,
             m.currency_exponent,
             m.direction,
             m.lifecycle_state,
             m.money_space_id,
             to_char(m.occurred_at AT TIME ZONE 'UTC', '${UTC_INSTANT_SQL}') AS occurred_at,
             m.planning_status,
             m.purpose
           FROM money_memos m
           LEFT JOIN categories c ON c.user_id = m.user_id AND c.id = m.category_id
           WHERE m.user_id = $1
             AND m.lifecycle_state IN ('active', 'archived')
             AND m.occurred_at >= $2::timestamptz
             AND m.occurred_at < $3::timestamptz
           ORDER BY m.occurred_at ASC, m.id ASC`,
          [accountId, priorBounds.startInclusive, selectedBounds.endExclusive],
        );
        const records: readonly MonthlyReviewCandidate[] = result.rows.map((row) => ({
          amountMinor: row.amount_minor,
          authority: "money_memo",
          categoryId: row.category_id,
          categoryName: row.category_name,
          categoryNormalizedName: row.category_normalized_name,
          currency: row.currency_code,
          currencyExponent: row.currency_exponent,
          direction: row.direction,
          lifecycle: row.lifecycle_state,
          moneySpaceId: row.money_space_id,
          occurredAt: row.occurred_at,
          planningStatus: row.planning_status,
          purpose: row.purpose,
        }));
        const currencies = calculateMonthlyReview({ priorBounds, records, selectedBounds });
        return Object.freeze({
          calculatedAt,
          currencies,
          month,
          priorMonth,
          reportingTimezone,
        });
      });
    } catch {
      throw new MonthlyReviewUnavailableError();
    }
  }
}

export {
  MonthlyReviewService,
  MonthlyReviewUnavailableError,
  type MonthlyReviewServiceOptions,
  type MonthlyReviewView,
};
