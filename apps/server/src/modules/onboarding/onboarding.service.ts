import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";

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
  ["expense", "Food & Drink", "starter_expense_food_drink"],
  ["expense", "Transport", "starter_expense_transport"],
  ["expense", "Housing", "starter_expense_housing"],
  ["expense", "Utilities", "starter_expense_utilities"],
  ["expense", "Shopping", "starter_expense_shopping"],
  ["expense", "Health", "starter_expense_health"],
  ["expense", "Education", "starter_expense_education"],
  ["expense", "Entertainment", "starter_expense_entertainment"],
  ["expense", "Travel", "starter_expense_travel"],
  ["expense", "Software & Services", "starter_expense_software_services"],
  ["expense", "Fees", "starter_expense_fees"],
  ["expense", "Other Expense", "starter_expense_other"],
  ["income", "Salary", "starter_income_salary"],
  ["income", "Freelance", "starter_income_freelance"],
  ["income", "Business", "starter_income_business"],
  ["income", "Gift", "starter_income_gift"],
  ["income", "Refund", "starter_income_refund"],
  ["income", "Other Income", "starter_income_other"],
] as const;

const STARTER_MONEY_SPACES = [
  ["Personal", "starter_space_personal"],
  ["Work", "starter_space_work"],
  ["Household", "starter_space_household"],
  ["Freelance", "starter_space_freelance"],
  ["Travel", "starter_space_travel"],
] as const;

function normalized(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
}

export class OnboardingService {
  private readonly pool: Pool;

  constructor(options: Readonly<OnboardingServiceOptions>) {
    this.pool = options.pool;
  }

  async getProfile(accountId: string): Promise<OnboardingProfile> {
    return withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<{
        onboarding_state: string;
        privacy_notice_accepted_at: string | null;
        privacy_notice_version: string | null;
      }>(
        `SELECT onboarding_state, privacy_notice_version, privacy_notice_accepted_at
         FROM profiles WHERE user_id = $1`,
        [accountId],
      );
      const row = result.rows[0];
      return row === undefined
        ? {
            onboardingState: "not_started",
            privacyNoticeAcceptedAt: null,
            privacyNoticeVersion: null,
          }
        : {
            onboardingState: row.onboarding_state as OnboardingProfile["onboardingState"],
            privacyNoticeAcceptedAt: row.privacy_notice_accepted_at,
            privacyNoticeVersion: row.privacy_notice_version,
          };
    });
  }

  async startOnboarding(accountId: string): Promise<void> {
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      await transaction.query(
        `INSERT INTO profiles (user_id, onboarding_state)
         VALUES ($1, 'in_progress')
         ON CONFLICT (user_id) DO UPDATE
           SET onboarding_state = 'in_progress', revision = profiles.revision + 1`,
        [accountId],
      );
    });
  }

  async completeOnboarding(accountId: string, privacyNoticeVersion: string): Promise<void> {
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      await transaction.query(
        `INSERT INTO profiles (
           user_id, onboarding_state, privacy_notice_version, privacy_notice_accepted_at
         ) VALUES ($1, 'complete', $2, now())
         ON CONFLICT (user_id) DO UPDATE SET
           onboarding_state = 'complete', privacy_notice_version = EXCLUDED.privacy_notice_version,
           privacy_notice_accepted_at = now(), revision = profiles.revision + 1`,
        [accountId, privacyNoticeVersion],
      );
    });
  }

  async getPreferences(accountId: string): Promise<UserPreferences | null> {
    return withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<{
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
      return row === undefined
        ? null
        : {
            defaultCurrency: row.default_currency,
            locale: row.locale,
            reportingTimezone: row.reporting_timezone,
            revision: row.revision,
          };
    });
  }

  async setPreferences(
    accountId: string,
    input: { defaultCurrency: string; reportingTimezone: string; locale: string },
  ): Promise<UserPreferences> {
    return withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<{
        default_currency: string;
        locale: string;
        reporting_timezone: string;
        revision: string;
      }>(
        `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           default_currency = EXCLUDED.default_currency,
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
    });
  }

  async seedStarterLabels(accountId: string): Promise<void> {
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      for (const [kind, name, starterKey] of STARTER_CATEGORIES) {
        await transaction.query(
          `INSERT INTO categories (id, user_id, kind, name, normalized_name, starter_key)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
           ON CONFLICT (user_id, starter_key) WHERE starter_key IS NOT NULL DO NOTHING`,
          [accountId, kind, name, normalized(name), starterKey],
        );
      }
      for (const [name, starterKey] of STARTER_MONEY_SPACES) {
        await transaction.query(
          `INSERT INTO money_spaces (id, user_id, name, normalized_name, starter_key)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)
           ON CONFLICT (user_id, starter_key) WHERE starter_key IS NOT NULL DO NOTHING`,
          [accountId, name, normalized(name), starterKey],
        );
      }
    });
  }
}
