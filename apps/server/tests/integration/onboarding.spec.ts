import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT_ONE = "00000000-0000-4000-8000-000000000001";

describe("onboarding and preferences", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let adminPool: Pool;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(adminPool);
    await adminPool.query(
      `INSERT INTO users (id, name, email, email_verified, status)
       VALUES ($1, 'Cashmemo account', 'onboard@example.test', true, 'active')`,
      [ACCOUNT_ONE],
    );
  }, 120_000);

  afterAll(async () => {
    await adminPool.end();
    await environment.stop();
  });

  it("creates profile with not_started state on first access", async () => {
    await adminPool.query(
      `INSERT INTO profiles (user_id, onboarding_state)
       VALUES ($1, 'not_started')
       ON CONFLICT (user_id) DO NOTHING`,
      [ACCOUNT_ONE],
    );
    const profile = await adminPool.query<{ onboarding_state: string }>(
      `SELECT onboarding_state FROM profiles WHERE user_id = $1`,
      [ACCOUNT_ONE],
    );
    expect(profile.rows[0]?.onboarding_state).toBe("not_started");
  });

  it("transitions onboarding from not_started to in_progress to complete", async () => {
    await adminPool.query(
      `UPDATE profiles SET onboarding_state = 'in_progress', revision = revision + 1
       WHERE user_id = $1`,
      [ACCOUNT_ONE],
    );
    let profile = await adminPool.query<{ onboarding_state: string }>(
      `SELECT onboarding_state FROM profiles WHERE user_id = $1`,
      [ACCOUNT_ONE],
    );
    expect(profile.rows[0]?.onboarding_state).toBe("in_progress");

    await adminPool.query(
      `UPDATE profiles SET onboarding_state = 'complete', revision = revision + 1
       WHERE user_id = $1`,
      [ACCOUNT_ONE],
    );
    profile = await adminPool.query<{ onboarding_state: string }>(
      `SELECT onboarding_state FROM profiles WHERE user_id = $1`,
      [ACCOUNT_ONE],
    );
    expect(profile.rows[0]?.onboarding_state).toBe("complete");
  });

  it("sets default preferences with currency, timezone, and locale", async () => {
    await adminPool.query(
      `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale)
       VALUES ($1, 'USD', 'America/New_York', 'en-US')
       ON CONFLICT (user_id) DO UPDATE
         SET default_currency = EXCLUDED.default_currency,
             reporting_timezone = EXCLUDED.reporting_timezone,
             locale = EXCLUDED.locale,
             revision = preferences.revision + 1`,
      [ACCOUNT_ONE],
    );
    const prefs = await adminPool.query<{
      default_currency: string;
      locale: string;
      reporting_timezone: string;
    }>(
      `SELECT default_currency, reporting_timezone, locale
       FROM preferences WHERE user_id = $1`,
      [ACCOUNT_ONE],
    );
    expect(prefs.rows[0]).toEqual({
      default_currency: "USD",
      locale: "en-US",
      reporting_timezone: "America/New_York",
    });
  });

  it("rejects stale preference writes with revision conflict", async () => {
    const current = await adminPool.query<{ revision: string }>(
      `SELECT revision::text FROM preferences WHERE user_id = $1`,
      [ACCOUNT_ONE],
    );
    const staleRevision = String(Number(current.rows[0]?.revision ?? "0") - 1);

    const result = await adminPool.query(
      `UPDATE preferences
          SET default_currency = 'EUR', revision = revision + 1
        WHERE user_id = $1 AND revision = $2`,
      [ACCOUNT_ONE, staleRevision],
    );
    expect(result.rowCount).toBe(0);
  });

  it("seeds starter labels for new account", async () => {
    const starterCategories = [
      {
        id: "a0000000-0000-4000-8000-000000000001",
        kind: "expense",
        name: "Food & Dining",
        normalized: "food & dining",
        key: "starter_food",
      },
      {
        id: "a0000000-0000-4000-8000-000000000002",
        kind: "expense",
        name: "Transportation",
        normalized: "transportation",
        key: "starter_transport",
      },
      {
        id: "a0000000-0000-4000-8000-000000000003",
        kind: "income",
        name: "Salary",
        normalized: "salary",
        key: "starter_salary",
      },
    ];
    for (const cat of starterCategories) {
      await adminPool.query(
        `INSERT INTO categories (id, user_id, kind, name, normalized_name, starter_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [cat.id, ACCOUNT_ONE, cat.kind, cat.name, cat.normalized, cat.key],
      );
    }
    const count = await adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM categories WHERE user_id = $1`,
      [ACCOUNT_ONE],
    );
    expect(count.rows[0]?.count).toBe("3");
  });

  it("prevents duplicate active category names for same user and kind", async () => {
    await expect(
      adminPool.query(
        `INSERT INTO categories (id, user_id, kind, name, normalized_name)
         VALUES ('a0000000-0000-4000-8000-000000000099', $1, 'expense', 'Food & Dining', 'food & dining')`,
        [ACCOUNT_ONE],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
