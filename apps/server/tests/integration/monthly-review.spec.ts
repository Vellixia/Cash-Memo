import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MonthlyReviewService } from "../../src/modules/reporting/monthly-review.service.js";
import {
  REVIEW_GOLDEN_ACCOUNT,
  REVIEW_NOW,
  REVIEW_OTHER_ACCOUNT,
  REVIEW_PRIOR_MONTH,
  REVIEW_SELECTED_MONTH,
  REVIEW_TIMEZONE,
  independentlyRecomputeMonthlyReview,
  monthlyReviewExportRows,
  reviewGoldenCategories,
  reviewGoldenSpaces,
  reviewedMonthlyReviewCurrencies,
  type MonthlyReviewExportRow,
} from "../fixtures/reporting/monthly-review-golden.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const OTHER_MEMO = "31000000-0000-4000-8000-000000000199";

async function insertMemo(
  pool: Pool,
  accountId: string,
  row: MonthlyReviewExportRow,
): Promise<void> {
  await pool.query(
    `INSERT INTO money_memos (
       id, user_id, direction, amount_minor, currency_code, currency_exponent,
       currency_registry_version, occurred_at, occurred_local, occurred_timezone,
       occurred_offset_minutes, timezone_database_version, category_id, money_space_id,
       purpose, planning_status, note, origin, lifecycle_state, prior_lifecycle_state,
       deleted_at, purge_after, revision
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 'review-golden-v1', $7::timestamptz,
       $7::timestamptz AT TIME ZONE 'UTC', 'UTC', 0, 'review-golden-tzdb', $8, $9,
       $10, $11, NULL, 'manual', $12::memo_lifecycle_state,
       CASE WHEN $12::text IN ('recently_deleted', 'purging') THEN 'active'::memo_prior_lifecycle_state ELSE NULL END,
       CASE WHEN $12::text IN ('recently_deleted', 'purging') THEN $7::timestamptz ELSE NULL END,
       CASE WHEN $12::text IN ('recently_deleted', 'purging') THEN $7::timestamptz + interval '30 days' ELSE NULL END,
       1
     )`,
    [
      row.id,
      accountId,
      row.direction,
      row.amountMinor,
      row.currency,
      row.currencyExponent,
      row.occurredAt,
      row.categoryId,
      row.moneySpaceId,
      row.purpose,
      row.planningStatus,
      row.lifecycle,
    ],
  );
}

describe(
  "monthly-review PostgreSQL/export golden oracle (FR-066–FR-072)",
  {
    concurrent: false,
  },
  () => {
    let environment: TestEnvironment;
    let adminPool: Pool;
    let runtimePool: Pool;
    let service: MonthlyReviewService;

    beforeAll(async () => {
      environment = await startTestEnvironment({ services: ["postgres"] });
      if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
      adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
      await applyMigrations(adminPool);
      await adminPool.query(
        `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'review-golden@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'review-other@cashmemo.test', true, 'active')`,
        [REVIEW_GOLDEN_ACCOUNT, REVIEW_OTHER_ACCOUNT],
      );
      await adminPool.query(
        `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale) VALUES
       ($1, 'USD', $3, 'en-US'),
       ($2, 'USD', $3, 'en-US')`,
        [REVIEW_GOLDEN_ACCOUNT, REVIEW_OTHER_ACCOUNT, REVIEW_TIMEZONE],
      );
      for (const category of reviewGoldenCategories) {
        await adminPool.query(
          `INSERT INTO categories (id, user_id, kind, name, normalized_name, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            category.id,
            REVIEW_GOLDEN_ACCOUNT,
            category.kind,
            category.name,
            category.normalizedName,
            category.status,
          ],
        );
      }
      for (const space of reviewGoldenSpaces) {
        await adminPool.query(
          `INSERT INTO money_spaces (id, user_id, name, normalized_name)
         VALUES ($1, $2, $3, lower($3))`,
          [space.id, REVIEW_GOLDEN_ACCOUNT, space.name],
        );
      }
      for (const row of monthlyReviewExportRows) {
        if (row.authority === "money_memo" && row.lifecycle !== "purged") {
          await insertMemo(adminPool, REVIEW_GOLDEN_ACCOUNT, row);
        }
      }
      await adminPool.query(
        `INSERT INTO compose_drafts (
         id, user_id, origin, source_completeness, candidate_fields, field_provenance,
         capture_started_at, capture_timezone, status, last_activity_at, expires_at
       ) VALUES (
         $1, $2, 'manual', 'incomplete', '{}'::jsonb, '{}'::jsonb,
         '2026-03-19T10:00:00Z', 'UTC', 'editing', '2026-03-19T10:00:00Z',
         '2026-03-26T10:00:00Z'
       )`,
        ["41000000-0000-4000-8000-000000000091", REVIEW_GOLDEN_ACCOUNT],
      );
      await adminPool.query(
        `INSERT INTO assisted_captures (
         id, user_id, draft_id, mode, state, capture_started_at
       ) VALUES ($1, $2, $3, 'text', 'editing', '2026-03-20T10:00:00Z')`,
        [
          "51000000-0000-4000-8000-000000000091",
          REVIEW_GOLDEN_ACCOUNT,
          "41000000-0000-4000-8000-000000000091",
        ],
      );
      const otherSource = monthlyReviewExportRows[3];
      if (otherSource === undefined) throw new Error("Golden source row missing");
      await insertMemo(adminPool, REVIEW_OTHER_ACCOUNT, {
        ...otherSource,
        categoryId: null,
        categoryName: null,
        categoryNormalizedName: null,
        id: OTHER_MEMO,
        moneySpaceId: null,
      });
      runtimePool = new Pool({
        connectionString: environment.postgres.connectionUri,
        max: 4,
        options: "-c role=cashmemo_runtime",
      });
      service = new MonthlyReviewService({ now: () => new Date(REVIEW_NOW), pool: runtimePool });
    }, 120_000);

    afterAll(async () => {
      await runtimePool.end();
      await adminPool.end();
      await environment.stop();
    });

    it("keeps reviewed export-shaped expectations independent and exact", () => {
      expect(independentlyRecomputeMonthlyReview()).toEqual(reviewedMonthlyReviewCurrencies);
    });

    it("matches selected/prior production review from real account-owned PostgreSQL rows", async () => {
      const review = await service.getMonthlyReview(REVIEW_GOLDEN_ACCOUNT, REVIEW_SELECTED_MONTH);
      expect(review).toMatchObject({
        currencies: reviewedMonthlyReviewCurrencies,
        month: REVIEW_SELECTED_MONTH,
        priorMonth: REVIEW_PRIOR_MONTH,
        reportingTimezone: REVIEW_TIMEZONE,
      });
    });

    it("proves deterministic category tie order, prior-zero, negative net, and month-only currencies", async () => {
      const review = await service.getMonthlyReview(REVIEW_GOLDEN_ACCOUNT, REVIEW_SELECTED_MONTH);
      const usd = review.currencies.find((section) => section.currency === "USD");
      const eur = review.currencies.find((section) => section.currency === "EUR");
      const jpy = review.currencies.find((section) => section.currency === "JPY");
      expect(usd?.largestExpenseCategories.map((bucket) => bucket.key)).toEqual([
        reviewGoldenCategories[0].id,
        reviewGoldenCategories[1].id,
        reviewGoldenCategories[2].id,
      ]);
      expect(eur).toMatchObject({
        netMinor: "-1500",
        priorMonth: { percentageChange: null, percentageUnavailableReason: "PRIOR_VALUE_ZERO" },
      });
      expect(jpy).toMatchObject({
        expenseMinor: "0",
        incomeMinor: "0",
        priorMonth: { expenseMinor: "700", percentageChange: "-100" },
      });
    });

    it("keeps another account's selected/prior financial rows outside the result under RLS", async () => {
      const review = await service.getMonthlyReview(REVIEW_OTHER_ACCOUNT, REVIEW_SELECTED_MONTH);
      expect(review.currencies).toEqual([
        {
          currency: "USD",
          currencyExponent: 2,
          expenseMinor: "0",
          incomeMinor: "10000",
          largestExpenseCategories: [],
          netMinor: "10000",
          priorMonth: {
            absoluteChangeMinor: "0",
            expenseMinor: "0",
            percentageChange: null,
            percentageUnavailableReason: "PRIOR_VALUE_ZERO",
          },
          unplannedExpenseMinor: "0",
        },
      ]);
    });
  },
);
