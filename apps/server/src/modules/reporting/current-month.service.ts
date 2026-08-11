import {
  Money,
  calculateCurrentMonth,
  reportingMonthBounds,
  reportingMonthForInstant,
  serializeMoney,
  type CurrentMonthCandidate,
  type CurrentMonthCurrencyOverview,
} from "@cashmemo/domain";

import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";

interface RecentMoneyMemo {
  readonly authoritative: true;
  readonly categoryId: string | null;
  readonly createdAt: string;
  readonly direction: "expense" | "income";
  readonly id: string;
  readonly lifecycle: "active";
  readonly money: {
    readonly amount: string;
    readonly amountMinor: string;
    readonly currency: string;
    readonly currencyExponent: number;
    readonly currencyRegistryVersion: string;
  };
  readonly moneySpaceId: string | null;
  readonly note: string | null;
  readonly occurrence: {
    readonly occurredAt: string;
    readonly occurredLocal: string;
    readonly occurredOffsetMinutes: number;
    readonly occurredTimezone: string;
    readonly timezoneDatabaseVersion: string;
  };
  readonly origin: "manual" | "natural_language" | "voice";
  readonly planningStatus: "planned" | "unplanned" | null;
  readonly purpose: "mixed" | "personal" | "work" | null;
  readonly revision: string;
  readonly updatedAt: string;
}

interface CurrentMonthOverview {
  readonly calculatedAt: string;
  readonly currencies: readonly CurrentMonthCurrencyOverview[];
  readonly period: string;
  readonly recentMemos: readonly RecentMoneyMemo[];
  readonly reportingTimezone: string;
}

interface CurrentMonthServiceOptions {
  readonly now?: () => Date;
  readonly pool: Pool;
}

interface ReportingRow {
  readonly amount_minor: string;
  readonly category_id: string | null;
  readonly category_name: string | null;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly direction: "expense" | "income";
  readonly lifecycle_state: "active" | "archived";
  readonly money_space_id: string | null;
  readonly occurred_at: string;
  readonly planning_status: "planned" | "unplanned" | null;
  readonly purpose: "mixed" | "personal" | "work" | null;
}

interface RecentRow {
  readonly amount_minor: string;
  readonly category_id: string | null;
  readonly created_at: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly currency_registry_version: string;
  readonly direction: "expense" | "income";
  readonly id: string;
  readonly money_space_id: string | null;
  readonly note: string | null;
  readonly occurred_at: string;
  readonly occurred_local: string;
  readonly occurred_offset_minutes: number;
  readonly occurred_timezone: string;
  readonly origin: "manual" | "natural_language" | "voice";
  readonly planning_status: "planned" | "unplanned" | null;
  readonly purpose: "mixed" | "personal" | "work" | null;
  readonly revision: string;
  readonly timezone_database_version: string;
  readonly updated_at: string;
}

class CurrentMonthUnavailableError extends Error {
  readonly code = "CURRENT_MONTH_CALCULATION_UNAVAILABLE";

  constructor() {
    super("Current-month calculation unavailable.");
    this.name = "CurrentMonthUnavailableError";
  }
}

const UTC_INSTANT_SQL = `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"`;
const LOCAL_DATE_TIME_SQL = `YYYY-MM-DD"T"HH24:MI:SS.MS`;

function mapRecent(row: RecentRow): RecentMoneyMemo {
  const money = serializeMoney(
    Money.fromMinor({
      amountMinor: row.amount_minor,
      currency: row.currency_code,
      currencyExponent: row.currency_exponent,
      currencyRegistryVersion: row.currency_registry_version,
    }),
  );
  return Object.freeze({
    authoritative: true,
    categoryId: row.category_id,
    createdAt: row.created_at,
    direction: row.direction,
    id: row.id,
    lifecycle: "active",
    money,
    moneySpaceId: row.money_space_id,
    note: row.note,
    occurrence: Object.freeze({
      occurredAt: row.occurred_at,
      occurredLocal: row.occurred_local,
      occurredOffsetMinutes: row.occurred_offset_minutes,
      occurredTimezone: row.occurred_timezone,
      timezoneDatabaseVersion: row.timezone_database_version,
    }),
    origin: row.origin,
    planningStatus: row.planning_status,
    purpose: row.purpose,
    revision: row.revision,
    updatedAt: row.updated_at,
  });
}

class CurrentMonthService {
  private readonly now: () => Date;
  private readonly pool: Pool;

  constructor(options: Readonly<CurrentMonthServiceOptions>) {
    this.pool = options.pool;
    this.now = options.now ?? (() => new Date());
  }

  async getCurrentMonth(accountId: string): Promise<CurrentMonthOverview> {
    const calculatedAt = this.now().toISOString();
    try {
      return await withAccountTransaction(this.pool, accountId, async (transaction) => {
        const preferenceResult = await transaction.query<{ reporting_timezone: string }>(
          `SELECT reporting_timezone FROM preferences WHERE user_id = $1`,
          [accountId],
        );
        const reportingTimezone = preferenceResult.rows[0]?.reporting_timezone;
        if (reportingTimezone === undefined) throw new CurrentMonthUnavailableError();
        const period = reportingMonthForInstant({
          instant: calculatedAt,
          reportingTimezone,
        });
        const bounds = reportingMonthBounds({ month: period, reportingTimezone });

        const reportingResult = await transaction.query<ReportingRow>(
          `SELECT
             m.amount_minor::text,
             m.category_id,
             c.name AS category_name,
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
          [accountId, bounds.startInclusive, bounds.endExclusive],
        );
        const candidates: readonly CurrentMonthCandidate[] = reportingResult.rows.map((row) => ({
          amountMinor: row.amount_minor,
          authority: "money_memo",
          categoryId: row.category_id,
          categoryName: row.category_name,
          currency: row.currency_code,
          currencyExponent: row.currency_exponent,
          direction: row.direction,
          lifecycle: row.lifecycle_state,
          moneySpaceId: row.money_space_id,
          occurredAt: row.occurred_at,
          planningStatus: row.planning_status,
          purpose: row.purpose,
        }));
        const currencies = calculateCurrentMonth({ bounds, records: candidates });

        const recentResult = await transaction.query<RecentRow>(
          `SELECT
             m.id,
             m.direction,
             m.amount_minor::text,
             m.currency_code,
             m.currency_exponent,
             m.currency_registry_version,
             to_char(m.occurred_at AT TIME ZONE 'UTC', '${UTC_INSTANT_SQL}') AS occurred_at,
             to_char(m.occurred_local, '${LOCAL_DATE_TIME_SQL}') AS occurred_local,
             m.occurred_timezone,
             m.occurred_offset_minutes,
             m.timezone_database_version,
             m.category_id,
             m.money_space_id,
             m.purpose,
             m.planning_status,
             m.note,
             m.origin,
             m.revision::text,
             to_char(m.created_at AT TIME ZONE 'UTC', '${UTC_INSTANT_SQL}') AS created_at,
             to_char(m.updated_at AT TIME ZONE 'UTC', '${UTC_INSTANT_SQL}') AS updated_at
           FROM money_memos m
           WHERE m.user_id = $1 AND m.lifecycle_state = 'active'
           ORDER BY m.occurred_at DESC, m.id DESC
           LIMIT 10`,
          [accountId],
        );
        const recentMemos = recentResult.rows.map(mapRecent);

        return Object.freeze({
          calculatedAt,
          currencies,
          period,
          recentMemos,
          reportingTimezone,
        });
      });
    } catch {
      throw new CurrentMonthUnavailableError();
    }
  }
}

export {
  CurrentMonthService,
  CurrentMonthUnavailableError,
  type CurrentMonthOverview,
  type CurrentMonthServiceOptions,
  type RecentMoneyMemo,
};
