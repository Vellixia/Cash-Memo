import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CurrentMonthService } from "../../src/modules/reporting/current-month.service.js";
import {
  GOLDEN_ACCOUNT,
  GOLDEN_MONTH,
  GOLDEN_NOW,
  GOLDEN_TIMEZONE,
  OTHER_ACCOUNT,
  goldenCategories,
  goldenExportRows,
  goldenSpaces,
  independentlyRecomputeGolden,
  reviewedGoldenCurrencies,
  type GoldenExportRow,
} from "../fixtures/reporting/current-month-golden.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const OTHER_MEMO = "30000000-0000-4000-8000-000000000099";

async function insertMemo(pool: Pool, accountId: string, row: GoldenExportRow): Promise<void> {
  await pool.query(
    `INSERT INTO money_memos (
       id, user_id, direction, amount_minor, currency_code, currency_exponent,
       currency_registry_version, occurred_at, occurred_local, occurred_timezone,
       occurred_offset_minutes, timezone_database_version, category_id, money_space_id,
       purpose, planning_status, note, origin, lifecycle_state, prior_lifecycle_state,
       deleted_at, purge_after, revision
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 'golden-v1', $7::timestamptz,
       $7::timestamptz AT TIME ZONE 'UTC', 'UTC', 0, 'golden-tzdb', $8, $9,
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
  "current-month PostgreSQL/export golden oracle (FR-061–FR-065, FR-072)",
  {
    concurrent: false,
  },
  () => {
    let environment: TestEnvironment;
    let adminPool: Pool;
    let runtimePool: Pool;
    let service: CurrentMonthService;

    beforeAll(async () => {
      environment = await startTestEnvironment({ services: ["postgres"] });
      if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
      adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
      await applyMigrations(adminPool);
      await adminPool.query(
        `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'golden@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'other-golden@cashmemo.test', true, 'active')`,
        [GOLDEN_ACCOUNT, OTHER_ACCOUNT],
      );
      await adminPool.query(
        `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale) VALUES
       ($1, 'USD', $3, 'en-US'),
       ($2, 'USD', $3, 'en-US')`,
        [GOLDEN_ACCOUNT, OTHER_ACCOUNT, GOLDEN_TIMEZONE],
      );
      for (const category of goldenCategories) {
        await adminPool.query(
          `INSERT INTO categories (id, user_id, kind, name, normalized_name)
         VALUES ($1, $2, $3, $4, lower($4))`,
          [category.id, GOLDEN_ACCOUNT, category.kind, category.name],
        );
      }
      for (const space of goldenSpaces) {
        await adminPool.query(
          `INSERT INTO money_spaces (id, user_id, name, normalized_name)
         VALUES ($1, $2, $3, lower($3))`,
          [space.id, GOLDEN_ACCOUNT, space.name],
        );
      }
      for (const row of goldenExportRows) {
        if (row.authority === "money_memo" && row.lifecycle !== "purged") {
          await insertMemo(adminPool, GOLDEN_ACCOUNT, row);
        }
      }
      await adminPool.query(
        `INSERT INTO compose_drafts (
         id, user_id, origin, source_completeness, candidate_fields, field_provenance,
         capture_started_at, capture_timezone, status, last_activity_at, expires_at
       ) VALUES (
         $1, $2, 'manual', 'incomplete', '{}'::jsonb, '{}'::jsonb,
         '2026-03-11T08:00:00Z', 'UTC', 'editing', '2026-03-11T08:00:00Z',
         '2026-03-18T08:00:00Z'
       )`,
        ["40000000-0000-4000-8000-000000000041", GOLDEN_ACCOUNT],
      );
      await adminPool.query(
        `INSERT INTO assisted_captures (
         id, user_id, draft_id, mode, state, capture_started_at
       ) VALUES ($1, $2, $3, 'text', 'editing', '2026-03-12T08:00:00Z')`,
        [
          "50000000-0000-4000-8000-000000000041",
          GOLDEN_ACCOUNT,
          "40000000-0000-4000-8000-000000000041",
        ],
      );
      const otherSource = goldenExportRows[0];
      if (otherSource === undefined) throw new Error("Golden source row missing");
      await insertMemo(adminPool, OTHER_ACCOUNT, {
        ...otherSource,
        categoryId: null,
        categoryName: null,
        id: OTHER_MEMO,
        moneySpaceId: null,
      });
      runtimePool = new Pool({
        connectionString: environment.postgres.connectionUri,
        max: 4,
        options: "-c role=cashmemo_runtime",
      });
      service = new CurrentMonthService({ now: () => new Date(GOLDEN_NOW), pool: runtimePool });
    }, 120_000);

    afterAll(async () => {
      await runtimePool.end();
      await adminPool.end();
      await environment.stop();
    });

    it("keeps the reviewed export-shaped oracle independent and exact", () => {
      expect(independentlyRecomputeGolden()).toEqual(reviewedGoldenCurrencies);
    });

    it("matches the independent oracle from account-owned PostgreSQL rows", async () => {
      const overview = await service.getCurrentMonth(GOLDEN_ACCOUNT);
      expect(overview.period).toBe(GOLDEN_MONTH);
      expect(overview.reportingTimezone).toBe(GOLDEN_TIMEZONE);
      expect(overview.currencies).toEqual(reviewedGoldenCurrencies);
    });

    it("uses a separate active-only predicate for recent memo presentation", async () => {
      const overview = await service.getCurrentMonth(GOLDEN_ACCOUNT);
      expect(overview.recentMemos.map((memo) => memo.id)).toEqual([
        "30000000-0000-4000-8000-000000000046",
        "30000000-0000-4000-8000-000000000043",
        "30000000-0000-4000-8000-000000000050",
        "30000000-0000-4000-8000-000000000049",
        "30000000-0000-4000-8000-000000000047",
        "30000000-0000-4000-8000-000000000041",
        "30000000-0000-4000-8000-000000000045",
      ]);
    });

    it("keeps another account's financial rows outside the result under RLS", async () => {
      const overview = await service.getCurrentMonth(OTHER_ACCOUNT);
      expect(overview.currencies).toEqual([
        {
          categoryBreakdown: [
            { amountMinor: "10000", key: "uncategorized", label: "Uncategorized" },
          ],
          currency: "USD",
          currencyExponent: 2,
          expenseMinor: "0",
          incomeMinor: "10000",
          netMinor: "10000",
          planningBreakdown: [{ amountMinor: "10000", key: "planned", label: "Planned" }],
          purposeBreakdown: [{ amountMinor: "10000", key: "work", label: "Work" }],
        },
      ]);
      expect(overview.recentMemos.map((memo) => memo.id)).toEqual([OTHER_MEMO]);
    });
  },
);
