import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const userStatus = pgEnum("user_status", [
  "pending_verification",
  "active",
  "deletion_grace",
  "purging",
  "purged",
  "locked",
]);
export const reauthScope = pgEnum("reauth_scope", [
  "export",
  "purge",
  "account_delete",
  "sessions",
  "preferences",
]);
export const onboardingState = pgEnum("onboarding_state", [
  "not_started",
  "in_progress",
  "complete",
]);
export const categoryKind = pgEnum("category_kind", ["income", "expense"]);
export const labelStatus = pgEnum("label_status", ["active", "inactive"]);
export const verificationPurpose = pgEnum("verification_purpose", [
  "verify_email",
  "reset_password",
]);

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: citext("email").notNull(),
    emailVerifiedAt: timestampWithTimezone("email_verified_at"),
    status: userStatus("status").notNull().default("pending_verification"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    unique("users_email_unique").on(table.email),
    check("users_revision_positive", sql`${table.revision} > 0`),
    check(
      "users_verified_active_state",
      sql`${table.status} NOT IN ('active', 'deletion_grace', 'purging') OR ${table.emailVerifiedAt} IS NOT NULL`,
    ),
  ],
);

export const credentialAccounts = pgTable(
  "credential_accounts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordChangedAt: timestampWithTimezone("password_changed_at").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("credential_accounts_owner_provider_unique").on(table.userId, table.provider),
    unique("credential_accounts_owner_id_unique").on(table.userId, table.id),
    check("credential_accounts_provider_credential", sql`${table.provider} = 'credential'`),
    check("credential_accounts_password_hash_nonempty", sql`length(${table.passwordHash}) > 0`),
    index("credential_accounts_owner_idx").on(table.userId),
  ],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: uuid("id").primaryKey(),
    purpose: verificationPurpose("purpose").notNull(),
    subjectHmac: bytea("subject_hmac").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    usedAt: timestampWithTimezone("used_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("verification_tokens_token_hash_unique").on(table.tokenHash),
    check(
      "verification_tokens_subject_hmac_nonempty",
      sql`octet_length(${table.subjectHmac}) >= 32`,
    ),
    check("verification_tokens_token_hash_nonempty", sql`octet_length(${table.tokenHash}) >= 32`),
    check("verification_tokens_expiry_after_create", sql`${table.expiresAt} > ${table.createdAt}`),
    index("verification_tokens_subject_purpose_idx").on(table.subjectHmac, table.purpose),
    index("verification_tokens_expiry_idx").on(table.expiresAt),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    unique("sessions_token_unique").on(table.token),
    unique("sessions_owner_id_unique").on(table.userId, table.id),
    check("sessions_expiry_after_create", sql`${table.expiresAt} > ${table.createdAt}`),
    index("sessions_owner_expiry_idx").on(table.userId, table.expiresAt),
  ],
);

export const reauthGrants = pgTable(
  "reauth_grants",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    scope: reauthScope("scope").array().notNull(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    usedAt: timestampWithTimezone("used_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.sessionId],
      foreignColumns: [sessions.userId, sessions.id],
      name: "reauth_grants_owned_session_fk",
    }).onDelete("cascade"),
    unique("reauth_grants_token_hash_unique").on(table.tokenHash),
    unique("reauth_grants_owner_id_unique").on(table.userId, table.id),
    check("reauth_grants_scope_nonempty", sql`cardinality(${table.scope}) > 0`),
    check(
      "reauth_grants_ten_minute_max",
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '10 minutes'`,
    ),
    index("reauth_grants_owner_expiry_idx").on(table.userId, table.expiresAt),
  ],
);

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    onboardingState: onboardingState("onboarding_state").notNull().default("not_started"),
    privacyNoticeVersion: text("privacy_notice_version"),
    privacyNoticeAcceptedAt: timestampWithTimezone("privacy_notice_accepted_at"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    check("profiles_revision_positive", sql`${table.revision} > 0`),
    check(
      "profiles_privacy_acceptance_consistent",
      sql`(${table.privacyNoticeVersion} IS NULL) = (${table.privacyNoticeAcceptedAt} IS NULL)`,
    ),
  ],
);

export const preferences = pgTable(
  "preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    defaultCurrency: text("default_currency").notNull(),
    reportingTimezone: text("reporting_timezone").notNull(),
    locale: text("locale").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    check("preferences_currency_code_format", sql`${table.defaultCurrency} ~ '^[A-Z]{3}$'`),
    check(
      "preferences_timezone_nonempty",
      sql`length(${table.reportingTimezone}) BETWEEN 1 AND 255`,
    ),
    check("preferences_locale_nonempty", sql`length(${table.locale}) BETWEEN 2 AND 35`),
    check("preferences_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: categoryKind("kind").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    status: labelStatus("status").notNull().default("active"),
    starterKey: text("starter_key"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    unique("categories_owner_id_unique").on(table.userId, table.id),
    uniqueIndex("categories_active_name_unique")
      .on(table.userId, table.kind, table.normalizedName)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("categories_starter_key_unique")
      .on(table.userId, table.starterKey)
      .where(sql`${table.starterKey} IS NOT NULL`),
    check("categories_name_length", sql`char_length(${table.name}) BETWEEN 1 AND 100`),
    check(
      "categories_normalized_name_length",
      sql`char_length(${table.normalizedName}) BETWEEN 1 AND 100`,
    ),
    check("categories_revision_positive", sql`${table.revision} > 0`),
    index("categories_owner_status_idx").on(table.userId, table.status),
  ],
);

export const moneySpaces = pgTable(
  "money_spaces",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    status: labelStatus("status").notNull().default("active"),
    starterKey: text("starter_key"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    unique("money_spaces_owner_id_unique").on(table.userId, table.id),
    uniqueIndex("money_spaces_active_name_unique")
      .on(table.userId, table.normalizedName)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("money_spaces_starter_key_unique")
      .on(table.userId, table.starterKey)
      .where(sql`${table.starterKey} IS NOT NULL`),
    check("money_spaces_name_length", sql`char_length(${table.name}) BETWEEN 1 AND 100`),
    check(
      "money_spaces_normalized_name_length",
      sql`char_length(${table.normalizedName}) BETWEEN 1 AND 100`,
    ),
    check("money_spaces_revision_positive", sql`${table.revision} > 0`),
    index("money_spaces_owner_status_idx").on(table.userId, table.status),
  ],
);
