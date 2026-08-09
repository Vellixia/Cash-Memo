import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

export const idempotencyOperation = pgEnum("idempotency_operation", [
  "signup_side_effect",
  "memo_create",
  "draft_confirmation",
  "export",
  "memo_delete",
  "account_delete",
]);
export const idempotencyState = pgEnum("idempotency_state", [
  "in_progress",
  "succeeded",
  "failed_retryable",
  "failed_final",
]);
export const safeResponseCode = pgEnum("safe_response_code", [
  "created",
  "accepted",
  "no_content",
  "conflict",
  "invalid_request",
  "unavailable",
]);
export const exportJobState = pgEnum("export_job_state", [
  "queued",
  "running",
  "ready",
  "failed",
  "canceled",
  "expired",
  "deleting",
  "deleted",
]);
export const operationFailureClass = pgEnum("operation_failure_class", [
  "availability",
  "timeout",
  "storage",
  "provider",
  "integrity",
  "policy",
  "unknown",
]);
export const accountDeletionState = pgEnum("account_deletion_state", [
  "grace",
  "canceled",
  "purging",
  "live_purged",
  "provider_pending",
  "complete",
  "failed",
]);
export const providerDeletionScope = pgEnum("provider_deletion_scope", [
  "stt",
  "ai",
  "email",
  "storage",
]);
export const providerDeletionState = pgEnum("provider_deletion_state", [
  "not_required",
  "queued",
  "requested",
  "confirmed",
  "pending_escalation",
  "failed",
]);
export const backgroundJobType = pgEnum("background_job_type", [
  "draft_expire",
  "memo_purge",
  "account_purge",
  "export_build",
  "export_delete",
  "provider_delete",
  "reconcile",
]);
export const backgroundJobState = pgEnum("background_job_state", [
  "ready",
  "leased",
  "retry_wait",
  "succeeded",
  "dead",
]);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operation: idempotencyOperation("operation").notNull(),
    key: uuid("key").notNull(),
    requestHmac: bytea("request_hmac").notNull(),
    state: idempotencyState("state").notNull(),
    resultType: text("result_type"),
    resultId: uuid("result_id"),
    resultRevision: bigint("result_revision", { mode: "bigint" }),
    responseCode: safeResponseCode("response_code"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_records_owner_operation_key_unique").on(
      table.userId,
      table.operation,
      table.key,
    ),
    check(
      "idempotency_records_expiry_after_create",
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '35 days'`,
    ),
    check(
      "idempotency_records_result_consistent",
      sql`(${table.resultType} IS NULL AND ${table.resultId} IS NULL AND ${table.resultRevision} IS NULL)
        OR (${table.resultType} IS NOT NULL AND ${table.resultId} IS NOT NULL)`,
    ),
    index("idempotency_records_expiry_idx").on(table.expiresAt),
  ],
);

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    schemaVersion: text("schema_version").notNull(),
    requestedAt: timestampWithTimezone("requested_at").notNull(),
    state: exportJobState("state").notNull().default("queued"),
    snapshotCutoff: timestampWithTimezone("snapshot_cutoff").notNull(),
    objectKeyCiphertext: bytea("object_key_ciphertext"),
    manifestSha256: bytea("manifest_sha256"),
    readyAt: timestampWithTimezone("ready_at"),
    expiresAt: timestampWithTimezone("expires_at"),
    deletedAt: timestampWithTimezone("deleted_at"),
    failureClass: operationFailureClass("failure_class"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    unique("export_jobs_owner_id_unique").on(table.userId, table.id),
    check("export_jobs_revision_positive", sql`${table.revision} > 0`),
    check(
      "export_jobs_ready_fields_consistent",
      sql`${table.state} <> 'ready' OR (
        ${table.objectKeyCiphertext} IS NOT NULL
        AND ${table.manifestSha256} IS NOT NULL
        AND ${table.readyAt} IS NOT NULL
        AND ${table.expiresAt} IS NOT NULL
        AND ${table.expiresAt} <= ${table.readyAt} + interval '24 hours'
      )`,
    ),
    index("export_jobs_owner_state_idx").on(table.userId, table.state, table.requestedAt),
    index("export_jobs_expiry_idx").on(table.state, table.expiresAt),
  ],
);

export const accountDeletions = pgTable(
  "account_deletions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    state: accountDeletionState("state").notNull().default("grace"),
    requestedAt: timestampWithTimezone("requested_at").notNull(),
    graceEndsAt: timestampWithTimezone("grace_ends_at").notNull(),
    irreversibleAt: timestampWithTimezone("irreversible_at"),
    livePurgeDueAt: timestampWithTimezone("live_purge_due_at"),
    livePurgedAt: timestampWithTimezone("live_purged_at"),
    completedAt: timestampWithTimezone("completed_at"),
    failureClass: operationFailureClass("failure_class"),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    unique("account_deletions_owner_id_unique").on(table.userId, table.id),
    uniqueIndex("account_deletions_one_current_per_owner")
      .on(table.userId)
      .where(sql`${table.state} NOT IN ('canceled', 'complete')`),
    check(
      "account_deletions_seven_day_grace",
      sql`${table.graceEndsAt} = ${table.requestedAt} + interval '7 days'`,
    ),
    check("account_deletions_revision_positive", sql`${table.revision} > 0`),
    check(
      "account_deletions_irreversible_fields",
      sql`${table.state} IN ('grace', 'canceled') OR ${table.irreversibleAt} IS NOT NULL`,
    ),
    check(
      "account_deletions_live_purge_due_bound",
      sql`${table.livePurgeDueAt} IS NULL OR ${table.livePurgeDueAt} <= ${table.graceEndsAt} + interval '24 hours'`,
    ),
    check(
      "account_deletions_complete_fields",
      sql`${table.state} <> 'complete' OR (${table.livePurgedAt} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
    index("account_deletions_state_due_idx").on(table.state, table.graceEndsAt),
  ],
);

export const providerDeletions = pgTable(
  "provider_deletions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    accountDeletionId: uuid("account_deletion_id").notNull(),
    providerDecisionVersion: text("provider_decision_version").notNull(),
    scope: providerDeletionScope("scope").notNull(),
    state: providerDeletionState("state").notNull(),
    providerReferenceHmac: bytea("provider_reference_hmac"),
    requestedAt: timestampWithTimezone("requested_at"),
    confirmedAt: timestampWithTimezone("confirmed_at"),
    nextCheckAt: timestampWithTimezone("next_check_at"),
    attempts: smallint("attempts").notNull().default(0),
    failureClass: operationFailureClass("failure_class"),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.accountDeletionId],
      foreignColumns: [accountDeletions.userId, accountDeletions.id],
      name: "provider_deletions_owned_account_deletion_fk",
    }).onDelete("cascade"),
    unique("provider_deletions_owner_id_unique").on(table.userId, table.id),
    unique("provider_deletions_request_scope_unique").on(table.accountDeletionId, table.scope),
    check("provider_deletions_attempt_range", sql`${table.attempts} BETWEEN 0 AND 100`),
    check(
      "provider_deletions_confirmation_consistent",
      sql`${table.state} <> 'confirmed' OR ${table.confirmedAt} IS NOT NULL`,
    ),
    index("provider_deletions_state_check_idx").on(table.state, table.nextCheckAt),
  ],
);

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: uuid("id").primaryKey(),
    userIdHmac: bytea("user_id_hmac"),
    jobType: backgroundJobType("job_type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    state: backgroundJobState("state").notNull().default("ready"),
    availableAt: timestampWithTimezone("available_at").notNull(),
    leasedUntil: timestampWithTimezone("leased_until"),
    leaseOwner: uuid("lease_owner"),
    attempts: smallint("attempts").notNull().default(0),
    maxAttempts: smallint("max_attempts").notNull(),
    lastErrorClass: operationFailureClass("last_error_class"),
    createdAt: timestampWithTimezone("created_at").notNull().defaultNow(),
    updatedAt: timestampWithTimezone("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("background_jobs_type_dedupe_unique").on(table.jobType, table.dedupeKey),
    check(
      "background_jobs_attempt_range",
      sql`${table.attempts} BETWEEN 0 AND ${table.maxAttempts} AND ${table.maxAttempts} > 0`,
    ),
    check(
      "background_jobs_lease_consistent",
      sql`${table.state} <> 'leased' OR (${table.leasedUntil} IS NOT NULL AND ${table.leaseOwner} IS NOT NULL)`,
    ),
    index("background_jobs_claim_idx").on(table.state, table.availableAt),
    index("background_jobs_lease_reclaim_idx").on(table.state, table.leasedUntil),
  ],
);

export const deletionSuppressionRecordContract = {
  fields: [
    "deletion_token",
    "entity_type",
    "suppression_key_version",
    "purged_at",
    "removal_not_before_at",
    "verification_state",
    "last_verified_at",
    "blocking_artifact_classes",
    "policy_version",
    "created_at",
    "updated_at",
  ],
  forbiddenFields: [
    "user_id",
    "account_id",
    "money_memo_id",
    "email",
    "amount",
    "note",
    "journal_metadata",
    "content_hash",
    "free_form_reason",
  ],
  storage: "external_kms_ledger",
  ttlDeletionAuthority: false,
} as const;
