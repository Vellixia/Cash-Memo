import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  categories,
  credentialAccounts,
  moneySpaces,
  preferences,
  profiles,
  reauthGrants,
  sessions,
  users,
  verificationTokens,
} from "../../src/adapters/postgres/schema/identity-labels.js";
import {
  assistedCaptures,
  composeDrafts,
  moneyMemos,
  providerAttempts,
  temporaryAudioMetadata,
} from "../../src/adapters/postgres/schema/journal-capture.js";
import {
  accountDeletions,
  backgroundJobs,
  deletionSuppressionRecordContract,
  exportJobs,
  idempotencyRecords,
  providerDeletions,
} from "../../src/adapters/postgres/schema/operations.js";
import {
  contentFreeMutationAudits,
  currencyRegistryEntries,
  currencyRegistryVersions,
  historyListStates,
} from "../../src/adapters/postgres/schema/reference-audit-history.js";

const rdsTables = [
  users,
  credentialAccounts,
  verificationTokens,
  sessions,
  reauthGrants,
  profiles,
  preferences,
  categories,
  moneySpaces,
  moneyMemos,
  composeDrafts,
  assistedCaptures,
  providerAttempts,
  temporaryAudioMetadata,
  idempotencyRecords,
  exportJobs,
  accountDeletions,
  providerDeletions,
  backgroundJobs,
  currencyRegistryVersions,
  currencyRegistryEntries,
  contentFreeMutationAudits,
  historyListStates,
] as const satisfies readonly AnyPgTable[];

const requiredColumnsByTable = {
  account_deletions: ["id", "user_id", "state", "grace_ends_at", "revision"],
  assisted_captures: ["id", "user_id", "draft_id", "mode", "state", "revision"],
  background_jobs: ["id", "job_type", "dedupe_key", "state", "available_at", "attempts"],
  categories: ["id", "user_id", "kind", "name", "normalized_name", "status", "revision"],
  compose_drafts: [
    "id",
    "user_id",
    "source_text",
    "candidate_fields",
    "field_provenance",
    "status",
    "expires_at",
    "revision",
  ],
  content_free_mutation_audits: [
    "id",
    "subject_hmac",
    "actor_session_hmac",
    "operation",
    "result",
    "expires_at",
  ],
  credential_accounts: ["id", "user_id", "provider", "password_hash", "password_changed_at"],
  currency_registry_entries: ["registry_version", "code", "exponent", "enabled"],
  currency_registry_versions: ["version", "source_cldr_version", "source_sha256", "status"],
  export_jobs: ["id", "user_id", "schema_version", "state", "snapshot_cutoff", "revision"],
  history_list_states: ["user_id", "version", "updated_at"],
  idempotency_records: ["id", "user_id", "operation", "key", "request_hmac", "state"],
  money_memos: [
    "id",
    "user_id",
    "direction",
    "amount_minor",
    "currency_code",
    "currency_exponent",
    "currency_registry_version",
    "occurred_at",
    "occurred_local",
    "occurred_timezone",
    "occurred_offset_minutes",
    "timezone_database_version",
    "lifecycle_state",
    "revision",
  ],
  money_spaces: ["id", "user_id", "name", "normalized_name", "status", "revision"],
  preferences: ["user_id", "default_currency", "reporting_timezone", "locale", "revision"],
  profiles: ["user_id", "onboarding_state", "privacy_notice_version", "revision"],
  provider_attempts: ["id", "user_id", "capture_id", "capability", "state", "attempt_number"],
  provider_deletions: ["id", "user_id", "account_deletion_id", "scope", "state"],
  reauth_grants: ["id", "user_id", "session_id", "token_hash", "scope", "expires_at"],
  sessions: ["id", "user_id", "token", "expires_at", "created_at", "updated_at"],
  temporary_audio_metadata: [
    "id",
    "user_id",
    "capture_id",
    "owner_instance_hmac",
    "storage_kind",
    "state",
    "expires_at",
    "revision",
  ],
  users: ["id", "email", "email_verified_at", "status", "revision"],
  verification_tokens: ["id", "purpose", "subject_hmac", "token_hash", "expires_at", "used_at"],
} as const;

interface InspectedColumn {
  dataType: string;
  name: string;
}

function inspectColumns(table: AnyPgTable): readonly InspectedColumn[] {
  const rawColumns: unknown = getTableColumns(table);
  if (rawColumns === null || typeof rawColumns !== "object" || Array.isArray(rawColumns)) {
    throw new Error("INVALID_DRIZZLE_COLUMN_MAP");
  }
  return Object.values(rawColumns as Record<string, unknown>).map((candidate) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("INVALID_DRIZZLE_COLUMN");
    }
    const column = candidate as Record<string, unknown>;
    if (typeof column["name"] !== "string" || typeof column["dataType"] !== "string") {
      throw new Error("INVALID_DRIZZLE_COLUMN_SHAPE");
    }
    return { dataType: column["dataType"], name: column["name"] };
  });
}

describe("PostgreSQL schema matches all 24 persistent model contracts", () => {
  it("declares exactly 23 RDS tables and keeps deletion suppression outside RDS", () => {
    const tableNames = rdsTables.map((table) => getTableConfig(table).name).sort();
    expect(tableNames).toEqual(Object.keys(requiredColumnsByTable).sort());
    expect(new Set(tableNames).size).toBe(23);
    expect(deletionSuppressionRecordContract).toEqual({
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
    });
    expect(tableNames).not.toContain("deletion_suppression_records");
  });

  it("contains every required data-model column with no exchange-rate surface", () => {
    for (const table of rdsTables) {
      const tableName = getTableConfig(table).name as keyof typeof requiredColumnsByTable;
      const columnNames = inspectColumns(table).map((column) => column.name);
      expect(columnNames).toEqual(expect.arrayContaining([...requiredColumnsByTable[tableName]]));
      expect(columnNames).not.toEqual(
        expect.arrayContaining([
          "exchange_rate",
          "base_currency",
          "converted_amount",
          "bank_account_number",
          "card_number",
          "cvv",
          "government_id",
        ]),
      );
    }
  });

  it("makes Money Memo the only RDS model with authoritative financial magnitude", () => {
    const magnitudeTables = rdsTables
      .filter((table) => inspectColumns(table).some((column) => column.name === "amount_minor"))
      .map((table) => getTableConfig(table).name);
    expect(magnitudeTables).toEqual(["money_memos"]);
    for (const table of [
      composeDrafts,
      assistedCaptures,
      providerAttempts,
      temporaryAudioMetadata,
    ]) {
      const columns = inspectColumns(table).map((column) => column.name);
      expect(columns).not.toContain("money_memo_id");
      expect(columns).not.toContain("authoritative");
      expect(columns).not.toContain("confirmed_at");
    }
  });

  it("puts user ownership directly on every account-owned table", () => {
    const accountOwned = rdsTables.filter(
      (table) =>
        ![
          "users",
          "verification_tokens",
          "background_jobs",
          "currency_registry_versions",
          "currency_registry_entries",
          "content_free_mutation_audits",
        ].includes(getTableConfig(table).name),
    );
    for (const table of accountOwned) {
      const columns = inspectColumns(table).map((column) => column.name);
      expect(columns, getTableConfig(table).name).toContain("user_id");
    }
  });

  it("declares named constraints and indexes for exact money, lifecycle, uniqueness, jobs, and traversal", () => {
    const constraintAndIndexNames = rdsTables.flatMap((table) => {
      const config = getTableConfig(table);
      return [
        ...config.checks.map((check) => check.name),
        ...config.indexes.map((index) => index.config.name),
        ...config.uniqueConstraints.map((constraint) => constraint.name),
      ];
    });
    expect(constraintAndIndexNames).toEqual(
      expect.arrayContaining([
        "money_memos_amount_positive",
        "money_memos_currency_exponent_range",
        "money_memos_lifecycle_fields_consistent",
        "compose_drafts_expiry_after_activity",
        "temporary_audio_size_range",
        "temporary_audio_expiry_within_hour",
        "idempotency_records_owner_operation_key_unique",
        "background_jobs_type_dedupe_unique",
        "categories_active_name_unique",
        "money_spaces_active_name_unique",
        "money_memos_history_order_idx",
        "money_memos_purge_due_idx",
        "history_list_states_positive_version",
        "currency_registry_entries_exponent_range",
      ]),
    );
  });

  it("forbids generic operational content channels", () => {
    for (const table of [
      providerAttempts,
      idempotencyRecords,
      backgroundJobs,
      contentFreeMutationAudits,
    ]) {
      const columns = inspectColumns(table);
      expect(columns.some((column) => column.dataType === "json")).toBe(false);
      expect(columns.map((column) => column.name)).not.toEqual(
        expect.arrayContaining([
          "payload",
          "metadata",
          "details",
          "error_text",
          "request_body",
          "response_body",
        ]),
      );
    }
  });
});
