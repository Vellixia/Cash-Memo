import type { Pool } from "pg";

export interface OnboardingProfile {
  readonly onboardingState: "not_started" | "in_progress" | "complete";
  readonly privacyNoticeVersion: string | null;
  readonly privacyNoticeAcceptedAt: string | null;
}

export interface UserPreferences {
  readonly defaultCurrency: string;
  readonly reportingTimezone: string;
  readonly locale: string;
  readonly revision: string;
}

export interface OnboardingServiceOptions {
  pool: Pool;
}

const STARTER_CATEGORIES = [
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
    kind: "expense",
    name: "Housing",
    normalized: "housing",
    key: "starter_housing",
  },
  {
    id: "a0000000-0000-4000-8000-000000000004",
    kind: "expense",
    name: "Utilities",
    normalized: "utilities",
    key: "starter_utilities",
  },
  {
    id: "a0000000-0000-4000-8000-000000000005",
    kind: "expense",
    name: "Entertainment",
    normalized: "entertainment",
    key: "starter_entertainment",
  },
  {
    id: "a0000000-0000-4000-8000-000000000006",
    kind: "income",
    name: "Salary",
    normalized: "salary",
    key: "starter_salary",
  },
  {
    id: "a0000000-0000-4000-8000-000000000007",
    kind: "income",
    name: "Freelance",
    normalized: "freelance",
    key: "starter_freelance",
  },
] as const;

export class OnboardingService {
  private readonly pool: Pool;

  constructor(options: Readonly<OnboardingServiceOptions>) {
    this.pool = options.pool;
  }

  async getProfile(accountId: string): Promise<OnboardingProfile> {
    const result = await this.pool.query<{
      onboarding_state: string;
      privacy_notice_accepted_at: string | null;
      privacy_notice_version: string | null;
    }>(
      `SELECT onboarding_state, privacy_notice_version, privacy_notice_accepted_at
       FROM profiles WHERE user_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return {
        onboardingState: "not_started",
        privacyNoticeAcceptedAt: null,
        privacyNoticeVersion: null,
      };
    }
    return {
      onboardingState: row.onboarding_state as OnboardingProfile["onboardingState"],
      privacyNoticeAcceptedAt: row.privacy_notice_accepted_at,
      privacyNoticeVersion: row.privacy_notice_version,
    };
  }

  async startOnboarding(accountId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO profiles (user_id, onboarding_state)
       VALUES ($1, 'in_progress')
       ON CONFLICT (user_id) DO UPDATE
         SET onboarding_state = 'in_progress', revision = profiles.revision + 1`,
      [accountId],
    );
  }

  async completeOnboarding(accountId: string, privacyNoticeVersion: string): Promise<void> {
    await this.pool.query(
      `UPDATE profiles
          SET onboarding_state = 'complete',
              privacy_notice_version = $2,
              privacy_notice_accepted_at = now(),
              revision = revision + 1
        WHERE user_id = $1`,
      [accountId, privacyNoticeVersion],
    );
  }

  async getPreferences(accountId: string): Promise<UserPreferences | null> {
    const result = await this.pool.query<{
      default_currency: string;
      locale: string;
      reporting_timezone: string;
      revision: string;
    }>(
      `SELECT default_currency, reporting_timezone, locale, revision::text
       FROM preferences WHERE user_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      defaultCurrency: row.default_currency,
      locale: row.locale,
      reportingTimezone: row.reporting_timezone,
      revision: row.revision,
    };
  }

  async setPreferences(
    accountId: string,
    input: { defaultCurrency: string; reportingTimezone: string; locale: string },
  ): Promise<UserPreferences> {
    const result = await this.pool.query<{
      default_currency: string;
      locale: string;
      reporting_timezone: string;
      revision: string;
    }>(
      `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET default_currency = EXCLUDED.default_currency,
             reporting_timezone = EXCLUDED.reporting_timezone,
             locale = EXCLUDED.locale,
             revision = preferences.revision + 1
       RETURNING default_currency, reporting_timezone, locale, revision::text`,
      [accountId, input.defaultCurrency, input.reportingTimezone, input.locale],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("PREFERENCES_WRITE_FAILED");
    return {
      defaultCurrency: row.default_currency,
      locale: row.locale,
      reportingTimezone: row.reporting_timezone,
      revision: row.revision,
    };
  }

  async seedStarterLabels(accountId: string): Promise<void> {
    for (const cat of STARTER_CATEGORIES) {
      await this.pool.query(
        `INSERT INTO categories (id, user_id, kind, name, normalized_name, starter_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [cat.id, accountId, cat.kind, cat.name, cat.normalized, cat.key],
      );
    }
  }
}
