import type { Pool, PoolClient } from "pg";

export const syntheticIds = {
  accountOne: "00000000-0000-4000-8000-000000000001",
  accountTwo: "00000000-0000-4000-8000-000000000002",
  categoryFood: "10000000-0000-4000-8000-000000000001",
  categorySalary: "10000000-0000-4000-8000-000000000002",
  categoryTravel: "10000000-0000-4000-8000-000000000003",
  draftOne: "30000000-0000-4000-8000-000000000001",
  memoArchived: "20000000-0000-4000-8000-000000000003",
  memoIdrExpense: "20000000-0000-4000-8000-000000000002",
  memoIdrIncome: "20000000-0000-4000-8000-000000000001",
  memoRecentlyDeleted: "20000000-0000-4000-8000-000000000004",
  memoUsdExpense: "20000000-0000-4000-8000-000000000005",
  spacePersonal: "40000000-0000-4000-8000-000000000001",
  spaceTravel: "40000000-0000-4000-8000-000000000002",
} as const;

export interface SyntheticSeedEnvironment {
  CASHMEMO_ALLOW_SYNTHETIC_SEED?: string;
  NODE_ENV?: string;
}

export function assertSyntheticSeedAllowed(environment: SyntheticSeedEnvironment): void {
  if (environment.CASHMEMO_ALLOW_SYNTHETIC_SEED !== "1" || environment.NODE_ENV === "production") {
    throw new Error("SYNTHETIC_SEED_NOT_ALLOWED");
  }
}

async function insertReferenceData(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO currency_registry_versions
       (version, source_cldr_version, reviewed_at, source_sha256, status)
     VALUES ('synthetic-cldr-v1', 'synthetic-test-only', timestamp '2026-01-01 00:00:00+00',
       decode(repeat('11', 32), 'hex'), 'active')
     ON CONFLICT (version) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO currency_registry_entries
       (registry_version, code, exponent, enabled, display_name_key)
     VALUES
       ('synthetic-cldr-v1', 'IDR', 0, true, 'currency.idr'),
       ('synthetic-cldr-v1', 'USD', 2, true, 'currency.usd')
     ON CONFLICT (registry_version, code) DO NOTHING`,
  );
}

async function insertAccounts(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO users (id, name, email, email_verified, status)
     VALUES
       ($1, 'Cashmemo account', 'synthetic-one@example.test', true, 'active'),
       ($2, 'Cashmemo account', 'synthetic-two@example.test', true, 'active')
     ON CONFLICT (id) DO NOTHING`,
    [syntheticIds.accountOne, syntheticIds.accountTwo],
  );
  await client.query(
    `INSERT INTO profiles
       (user_id, onboarding_state, privacy_notice_version, privacy_notice_accepted_at)
     VALUES
       ($1, 'complete', 'synthetic-v1', timestamp '2026-01-01 00:00:00+00'),
       ($2, 'complete', 'synthetic-v1', timestamp '2026-01-01 00:00:00+00')
     ON CONFLICT (user_id) DO NOTHING`,
    [syntheticIds.accountOne, syntheticIds.accountTwo],
  );
  await client.query(
    `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale)
     VALUES
       ($1, 'IDR', 'Asia/Jakarta', 'id-ID'),
       ($2, 'USD', 'America/New_York', 'en-US')
     ON CONFLICT (user_id) DO NOTHING`,
    [syntheticIds.accountOne, syntheticIds.accountTwo],
  );
  await client.query(
    `INSERT INTO history_list_states (user_id, version)
     VALUES ($1, 1), ($2, 1)
     ON CONFLICT (user_id) DO NOTHING`,
    [syntheticIds.accountOne, syntheticIds.accountTwo],
  );
}

async function insertLabels(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO categories (id, user_id, kind, name, normalized_name, starter_key)
     VALUES
       ($1, $2, 'expense', 'Food', 'food', 'expense.food'),
       ($3, $2, 'income', 'Salary', 'salary', 'income.salary'),
       ($4, $5, 'expense', 'Travel', 'travel', 'expense.travel')
     ON CONFLICT (id) DO NOTHING`,
    [
      syntheticIds.categoryFood,
      syntheticIds.accountOne,
      syntheticIds.categorySalary,
      syntheticIds.categoryTravel,
      syntheticIds.accountTwo,
    ],
  );
  await client.query(
    `INSERT INTO money_spaces (id, user_id, name, normalized_name, starter_key)
     VALUES
       ($1, $2, 'Personal', 'personal', 'personal'),
       ($3, $4, 'Travel', 'travel', 'travel')
     ON CONFLICT (id) DO NOTHING`,
    [
      syntheticIds.spacePersonal,
      syntheticIds.accountOne,
      syntheticIds.spaceTravel,
      syntheticIds.accountTwo,
    ],
  );
}

async function insertMemos(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO money_memos (
       id, user_id, direction, amount_minor, currency_code, currency_exponent,
       currency_registry_version, occurred_at, occurred_local, occurred_timezone,
       occurred_offset_minutes, timezone_database_version, category_id, money_space_id,
       purpose, planning_status, note, origin, lifecycle_state,
       prior_lifecycle_state, deleted_at, purge_after
     ) VALUES
       ($1, $2, 'income', 8500000, 'IDR', 0, 'synthetic-cldr-v1',
        timestamp '2026-01-15 02:00:00+00', timestamp '2026-01-15 09:00:00',
        'Asia/Jakarta', 420, 'synthetic-2026a', $3, $4, 'personal', 'planned',
        'Synthetic salary', 'manual', 'active', NULL, NULL, NULL),
       ($5, $2, 'expense', 85000, 'IDR', 0, 'synthetic-cldr-v1',
        timestamp '2026-01-16 05:30:00+00', timestamp '2026-01-16 12:30:00',
        'Asia/Jakarta', 420, 'synthetic-2026a', $6, $4, 'work', 'unplanned',
        'Synthetic lunch', 'natural_language', 'active', NULL, NULL, NULL),
       ($7, $2, 'expense', 150000, 'IDR', 0, 'synthetic-cldr-v1',
        timestamp '2025-12-20 03:00:00+00', timestamp '2025-12-20 10:00:00',
        'Asia/Jakarta', 420, 'synthetic-2026a', $6, $4, 'personal', 'planned',
        NULL, 'manual', 'archived', NULL, NULL, NULL),
       ($8, $2, 'expense', 25000, 'IDR', 0, 'synthetic-cldr-v1',
        timestamp '2026-01-10 04:00:00+00', timestamp '2026-01-10 11:00:00',
        'Asia/Jakarta', 420, 'synthetic-2026a', $6, $4, NULL, NULL,
        NULL, 'manual', 'recently_deleted', 'active',
        timestamp '2026-01-20 00:00:00+00', timestamp '2026-02-19 00:00:00+00'),
       ($9, $10, 'expense', 12000, 'USD', 2, 'synthetic-cldr-v1',
        timestamp '2026-01-15 17:00:00+00', timestamp '2026-01-15 12:00:00',
        'America/New_York', -300, 'synthetic-2026a', $11, $12, 'personal',
        'planned', 'Synthetic flight', 'voice', 'active', NULL, NULL, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [
      syntheticIds.memoIdrIncome,
      syntheticIds.accountOne,
      syntheticIds.categorySalary,
      syntheticIds.spacePersonal,
      syntheticIds.memoIdrExpense,
      syntheticIds.categoryFood,
      syntheticIds.memoArchived,
      syntheticIds.memoRecentlyDeleted,
      syntheticIds.memoUsdExpense,
      syntheticIds.accountTwo,
      syntheticIds.categoryTravel,
      syntheticIds.spaceTravel,
    ],
  );
}

async function insertDraft(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO compose_drafts (
       id, user_id, origin, source_text, source_completeness, candidate_fields,
       field_provenance, capture_started_at, capture_timezone, status,
       last_activity_at, expires_at
     ) VALUES (
       $1, $2, 'natural_language', 'Synthetic draft only', 'complete', $3::jsonb,
       $4::jsonb, timestamp '2026-01-21 03:00:00+00', 'Asia/Jakarta', 'reviewable',
       timestamp '2026-01-21 03:00:00+00', timestamp '2026-01-28 03:00:00+00'
     ) ON CONFLICT (id) DO NOTHING`,
    [
      syntheticIds.draftOne,
      syntheticIds.accountOne,
      JSON.stringify({
        amount: { currency: "IDR", decimal: "85000" },
        direction: "expense",
        note: "Synthetic draft only",
      }),
      JSON.stringify({
        amount: { source: "parsed" },
        direction: { source: "parsed" },
        note: { source: "user" },
      }),
    ],
  );
}

export async function seedSyntheticData(
  pool: Pool,
  environment: SyntheticSeedEnvironment,
): Promise<void> {
  assertSyntheticSeedAllowed(environment);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertReferenceData(client);
    await insertAccounts(client);
    await insertLabels(client);
    await insertMemos(client);
    await insertDraft(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
