import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { categories, moneySpaces, users } from "./identity-labels.js";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const memoDirection = pgEnum("memo_direction", ["income", "expense"]);
export const memoOrigin = pgEnum("memo_origin", ["manual", "natural_language", "voice"]);
export const memoPurpose = pgEnum("memo_purpose", ["personal", "work", "mixed"]);
export const planningStatus = pgEnum("planning_status", ["planned", "unplanned"]);
export const memoLifecycleState = pgEnum("memo_lifecycle_state", [
  "active",
  "archived",
  "recently_deleted",
  "purging",
]);
export const memoPriorLifecycleState = pgEnum("memo_prior_lifecycle_state", ["active", "archived"]);
export const sourceCompleteness = pgEnum("source_completeness", [
  "complete",
  "incomplete",
  "not_applicable",
]);
export const composeDraftStatus = pgEnum("compose_draft_status", [
  "editing",
  "processing",
  "reviewable",
  "blocked",
  "failed_recoverable",
]);
export const captureMode = pgEnum("capture_mode", ["text", "voice"]);
export const assistedCaptureState = pgEnum("assisted_capture_state", [
  "editing",
  "extracting",
  "recording",
  "audio_ready",
  "transcribing",
  "transcript_review",
  "draft_review",
  "correction_required",
  "failed_recoverable",
  "cleanup_scheduled",
]);
export const captureErrorCode = pgEnum("capture_error_code", [
  "network_unavailable",
  "stt_unavailable",
  "extraction_unavailable",
  "invalid_output",
  "ambiguous_output",
  "audio_invalid",
  "privacy_blocked",
]);
export const providerCapability = pgEnum("provider_capability", [
  "stt",
  "extraction",
  "email",
  "provider_delete",
]);
export const providerAttemptState = pgEnum("provider_attempt_state", [
  "started",
  "succeeded",
  "retryable_failed",
  "terminal_failed",
  "invalid_output",
]);
export const providerErrorClass = pgEnum("provider_error_class", [
  "availability",
  "timeout",
  "rate_limited",
  "invalid_request",
  "invalid_response",
  "policy",
  "unknown",
]);
export const audioStorageKind = pgEnum("audio_storage_kind", ["memory", "ephemeral_file"]);
export const audioState = pgEnum("audio_state", [
  "receiving",
  "ready",
  "transcribing",
  "deleting",
  "deleted",
  "expired",
  "delete_failed",
]);
export const audioMediaType = pgEnum("audio_media_type", [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
]);
export const audioDeletionReason = pgEnum("audio_deletion_reason", [
  "transcribed",
  "canceled",
  "failure",
  "expired",
  "task_terminated",
]);

export interface MoneyMemoDraftFields {
  amount?: { currency: string; decimal: string };
  categoryId?: string | null;
  direction?: "expense" | "income";
  moneySpaceId?: string | null;
  note?: string | null;
  occurredLocal?: string;
  occurredTimezone?: string;
  planningStatus?: "planned" | "unplanned" | null;
  purpose?: "mixed" | "personal" | "work" | null;
}

export type DraftFieldProvenance = Record<
  string,
  {
    source: "ai" | "parsed" | "stt" | "user";
    uncertaintyCode?: string;
  }
>;

export const moneyMemos = pgTable(
  "money_memos",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    direction: memoDirection("direction").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currencyCode: text("currency_code").notNull(),
    currencyExponent: smallint("currency_exponent").notNull(),
    currencyRegistryVersion: text("currency_registry_version").notNull(),
    occurredAt: timestampWithTimezone("occurred_at").notNull(),
    occurredLocal: timestamp("occurred_local", { mode: "date", withTimezone: false }).notNull(),
    occurredTimezone: text("occurred_timezone").notNull(),
    occurredOffsetMinutes: smallint("occurred_offset_minutes").notNull(),
    timezoneDatabaseVersion: text("timezone_database_version").notNull(),
    categoryId: uuid("category_id"),
    moneySpaceId: uuid("money_space_id"),
    purpose: memoPurpose("purpose"),
    planningStatus: planningStatus("planning_status"),
    note: text("note"),
    searchDocument: text("search_document").notNull().default(""),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple'::regconfig, coalesce(${sql.raw('"search_document"')}, ''))`,
    ),
    origin: memoOrigin("origin").notNull(),
    lifecycleState: memoLifecycleState("lifecycle_state").notNull().default("active"),
    priorLifecycleState: memoPriorLifecycleState("prior_lifecycle_state"),
    deletedAt: timestampWithTimezone("deleted_at"),
    purgeAfter: timestampWithTimezone("purge_after"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    unique("money_memos_owner_id_unique").on(table.userId, table.id),
    foreignKey({
      columns: [table.userId, table.categoryId],
      foreignColumns: [categories.userId, categories.id],
      name: "money_memos_owned_category_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.userId, table.moneySpaceId],
      foreignColumns: [moneySpaces.userId, moneySpaces.id],
      name: "money_memos_owned_money_space_fk",
    }).onDelete("restrict"),
    check("money_memos_amount_positive", sql`${table.amountMinor} > 0`),
    check("money_memos_currency_code_format", sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check("money_memos_currency_exponent_range", sql`${table.currencyExponent} BETWEEN 0 AND 3`),
    check("money_memos_offset_range", sql`${table.occurredOffsetMinutes} BETWEEN -840 AND 840`),
    check(
      "money_memos_note_length",
      sql`${table.note} IS NULL OR octet_length(${table.note}) <= 4000`,
    ),
    check("money_memos_revision_positive", sql`${table.revision} > 0`),
    check(
      "money_memos_lifecycle_fields_consistent",
      sql`(
        ${table.lifecycleState} IN ('active', 'archived')
        AND ${table.priorLifecycleState} IS NULL
        AND ${table.deletedAt} IS NULL
        AND ${table.purgeAfter} IS NULL
      ) OR (
        ${table.lifecycleState} = 'recently_deleted'
        AND ${table.priorLifecycleState} IS NOT NULL
        AND ${table.deletedAt} IS NOT NULL
        AND ${table.purgeAfter} IS NOT NULL
        AND ${table.purgeAfter} > ${table.deletedAt}
      ) OR (
        ${table.lifecycleState} = 'purging'
        AND ${table.priorLifecycleState} IS NOT NULL
        AND ${table.deletedAt} IS NOT NULL
        AND ${table.purgeAfter} IS NOT NULL
      )`,
    ),
    index("money_memos_history_order_idx").on(
      table.userId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index("money_memos_lifecycle_history_idx").on(
      table.userId,
      table.lifecycleState,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index("money_memos_category_history_idx").on(
      table.userId,
      table.categoryId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index("money_memos_space_history_idx").on(
      table.userId,
      table.moneySpaceId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index("money_memos_direction_currency_idx").on(
      table.userId,
      table.direction,
      table.currencyCode,
      table.occurredAt,
    ),
    index("money_memos_note_search_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${table.note}, ''))`,
    ),
    index("money_memos_search_vector_idx").using("gin", table.searchVector),
    index("money_memos_purge_due_idx")
      .on(table.userId, table.purgeAfter)
      .where(sql`${table.lifecycleState} IN ('recently_deleted', 'purging')`),
  ],
);

export const composeDrafts = pgTable(
  "compose_drafts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    origin: memoOrigin("origin").notNull(),
    sourceText: text("source_text"),
    sourceCompleteness: sourceCompleteness("source_completeness").notNull(),
    candidateFields: jsonb("candidate_fields").$type<MoneyMemoDraftFields>().notNull(),
    fieldProvenance: jsonb("field_provenance").$type<DraftFieldProvenance>().notNull(),
    captureStartedAt: timestampWithTimezone("capture_started_at").notNull(),
    captureTimezone: text("capture_timezone").notNull(),
    status: composeDraftStatus("status").notNull().default("editing"),
    lastActivityAt: timestampWithTimezone("last_activity_at").notNull(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    unique("compose_drafts_owner_id_unique").on(table.userId, table.id),
    check(
      "compose_drafts_expiry_after_activity",
      sql`${table.expiresAt} = ${table.lastActivityAt} + interval '7 days'`,
    ),
    check("compose_drafts_revision_positive", sql`${table.revision} > 0`),
    index("compose_drafts_owner_activity_idx").on(table.userId, table.lastActivityAt),
    index("compose_drafts_expiry_idx").on(table.expiresAt),
  ],
);

export const assistedCaptures = pgTable(
  "assisted_captures",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id").notNull(),
    mode: captureMode("mode").notNull(),
    state: assistedCaptureState("state").notNull().default("editing"),
    sttConsentVersion: text("stt_consent_version"),
    aiConsentVersion: text("ai_consent_version"),
    captureStartedAt: timestampWithTimezone("capture_started_at").notNull(),
    lastErrorCode: captureErrorCode("last_error_code"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.draftId],
      foreignColumns: [composeDrafts.userId, composeDrafts.id],
      name: "assisted_captures_owned_draft_fk",
    }).onDelete("cascade"),
    unique("assisted_captures_owner_id_unique").on(table.userId, table.id),
    check("assisted_captures_revision_positive", sql`${table.revision} > 0`),
    check(
      "assisted_captures_voice_consent",
      sql`${table.mode} <> 'voice' OR ${table.state} IN ('editing', 'recording') OR ${table.sttConsentVersion} IS NOT NULL`,
    ),
    index("assisted_captures_owner_state_idx").on(table.userId, table.state),
  ],
);

export const providerAttempts = pgTable(
  "provider_attempts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    captureId: uuid("capture_id").notNull(),
    capability: providerCapability("capability").notNull(),
    providerDecisionVersion: text("provider_decision_version").notNull(),
    providerRequestIdHmac: bytea("provider_request_id_hmac"),
    state: providerAttemptState("state").notNull(),
    attemptNumber: smallint("attempt_number").notNull(),
    startedAt: timestampWithTimezone("started_at").notNull(),
    finishedAt: timestampWithTimezone("finished_at"),
    errorClass: providerErrorClass("error_class"),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.captureId],
      foreignColumns: [assistedCaptures.userId, assistedCaptures.id],
      name: "provider_attempts_owned_capture_fk",
    }).onDelete("cascade"),
    check("provider_attempts_attempt_range", sql`${table.attemptNumber} BETWEEN 1 AND 10`),
    check(
      "provider_attempts_terminal_finished",
      sql`${table.state} = 'started' OR ${table.finishedAt} IS NOT NULL`,
    ),
    index("provider_attempts_capture_capability_idx").on(
      table.userId,
      table.captureId,
      table.capability,
      table.attemptNumber,
    ),
  ],
);

export const temporaryAudioMetadata = pgTable(
  "temporary_audio_metadata",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    captureId: uuid("capture_id").notNull(),
    ownerInstanceHmac: bytea("owner_instance_hmac").notNull(),
    storageKind: audioStorageKind("storage_kind").notNull(),
    state: audioState("state").notNull(),
    byteSize: integer("byte_size"),
    declaredMediaType: audioMediaType("declared_media_type").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    deletedAt: timestampWithTimezone("deleted_at"),
    deletionReason: audioDeletionReason("deletion_reason"),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.captureId],
      foreignColumns: [assistedCaptures.userId, assistedCaptures.id],
      name: "temporary_audio_owned_capture_fk",
    }).onDelete("cascade"),
    unique("temporary_audio_owner_id_unique").on(table.userId, table.id),
    check(
      "temporary_audio_size_range",
      sql`${table.byteSize} IS NULL OR ${table.byteSize} BETWEEN 0 AND 10485760`,
    ),
    check(
      "temporary_audio_expiry_within_hour",
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '1 hour'`,
    ),
    check("temporary_audio_revision_positive", sql`${table.revision} > 0`),
    check(
      "temporary_audio_terminal_metadata",
      sql`${table.state} NOT IN ('deleted', 'expired') OR (${table.deletedAt} IS NOT NULL AND ${table.deletionReason} IS NOT NULL)`,
    ),
    index("temporary_audio_expiry_idx").on(table.state, table.expiresAt),
    index("temporary_audio_owner_capture_idx").on(table.userId, table.captureId),
  ],
);
