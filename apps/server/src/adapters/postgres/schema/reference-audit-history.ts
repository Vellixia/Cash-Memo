import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./identity-labels.js";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const currencyRegistryStatus = pgEnum("currency_registry_status", ["active", "retired"]);
export const auditResult = pgEnum("audit_result", ["succeeded", "conflict", "denied", "failed"]);

export const currencyRegistryVersions = pgTable(
  "currency_registry_versions",
  {
    version: text("version").primaryKey(),
    sourceCldrVersion: text("source_cldr_version").notNull(),
    reviewedAt: timestampWithTimezone("reviewed_at").notNull(),
    sourceSha256: bytea("source_sha256").notNull(),
    status: currencyRegistryStatus("status").notNull(),
  },
  (table) => [
    check("currency_registry_versions_name_nonempty", sql`length(${table.version}) > 0`),
    check(
      "currency_registry_versions_source_nonempty",
      sql`length(${table.sourceCldrVersion}) > 0`,
    ),
    check(
      "currency_registry_versions_sha256_length",
      sql`octet_length(${table.sourceSha256}) = 32`,
    ),
    index("currency_registry_versions_status_idx").on(table.status),
  ],
);

export const currencyRegistryEntries = pgTable(
  "currency_registry_entries",
  {
    registryVersion: text("registry_version").notNull(),
    code: text("code").notNull(),
    exponent: smallint("exponent").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    displayNameKey: text("display_name_key").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.registryVersion, table.code] }),
    foreignKey({
      columns: [table.registryVersion],
      foreignColumns: [currencyRegistryVersions.version],
      name: "currency_registry_entries_version_fk",
    }).onDelete("restrict"),
    check("currency_registry_entries_code_format", sql`${table.code} ~ '^[A-Z]{3}$'`),
    check("currency_registry_entries_exponent_range", sql`${table.exponent} BETWEEN 0 AND 3`),
    check(
      "currency_registry_entries_display_key_nonempty",
      sql`length(${table.displayNameKey}) > 0`,
    ),
    index("currency_registry_entries_enabled_idx").on(table.enabled, table.code),
  ],
);

export const contentFreeMutationAudits = pgTable(
  "content_free_mutation_audits",
  {
    id: uuid("id").primaryKey(),
    subjectHmac: bytea("subject_hmac").notNull(),
    actorSessionHmac: bytea("actor_session_hmac").notNull(),
    operation: text("operation").notNull(),
    fromRevision: bigint("from_revision", { mode: "bigint" }),
    toRevision: bigint("to_revision", { mode: "bigint" }),
    result: auditResult("result").notNull(),
    occurredAt: timestampWithTimezone("occurred_at").notNull(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
  },
  (table) => [
    check("content_free_audits_subject_hmac_length", sql`octet_length(${table.subjectHmac}) = 32`),
    check(
      "content_free_audits_actor_hmac_length",
      sql`octet_length(${table.actorSessionHmac}) = 32`,
    ),
    check("content_free_audits_operation_nonempty", sql`length(${table.operation}) > 0`),
    check(
      "content_free_audits_revision_order",
      sql`${table.fromRevision} IS NULL OR ${table.toRevision} IS NULL OR ${table.toRevision} >= ${table.fromRevision}`,
    ),
    check(
      "content_free_audits_retention_bound",
      sql`${table.expiresAt} > ${table.occurredAt} AND ${table.expiresAt} <= ${table.occurredAt} + interval '35 days'`,
    ),
    index("content_free_audits_expiry_idx").on(table.expiresAt),
  ],
);

export const historyListStates = pgTable(
  "history_list_states",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    version: bigint("version", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [check("history_list_states_positive_version", sql`${table.version} > 0`)],
);
