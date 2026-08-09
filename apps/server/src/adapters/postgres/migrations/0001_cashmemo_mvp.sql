CREATE EXTENSION IF NOT EXISTS "citext";--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."label_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."onboarding_state" AS ENUM('not_started', 'in_progress', 'complete');--> statement-breakpoint
CREATE TYPE "public"."reauth_scope" AS ENUM('export', 'purge', 'account_delete', 'sessions', 'preferences');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending_verification', 'active', 'deletion_grace', 'purging', 'purged', 'locked');--> statement-breakpoint
CREATE TYPE "public"."verification_purpose" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TYPE "public"."assisted_capture_state" AS ENUM('editing', 'extracting', 'recording', 'audio_ready', 'transcribing', 'transcript_review', 'draft_review', 'correction_required', 'failed_recoverable', 'cleanup_scheduled');--> statement-breakpoint
CREATE TYPE "public"."audio_deletion_reason" AS ENUM('transcribed', 'canceled', 'failure', 'expired', 'task_terminated');--> statement-breakpoint
CREATE TYPE "public"."audio_media_type" AS ENUM('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav');--> statement-breakpoint
CREATE TYPE "public"."audio_state" AS ENUM('receiving', 'ready', 'transcribing', 'deleting', 'deleted', 'expired', 'delete_failed');--> statement-breakpoint
CREATE TYPE "public"."audio_storage_kind" AS ENUM('memory', 'ephemeral_file');--> statement-breakpoint
CREATE TYPE "public"."capture_error_code" AS ENUM('network_unavailable', 'stt_unavailable', 'extraction_unavailable', 'invalid_output', 'ambiguous_output', 'audio_invalid', 'privacy_blocked');--> statement-breakpoint
CREATE TYPE "public"."capture_mode" AS ENUM('text', 'voice');--> statement-breakpoint
CREATE TYPE "public"."compose_draft_status" AS ENUM('editing', 'processing', 'reviewable', 'blocked', 'failed_recoverable');--> statement-breakpoint
CREATE TYPE "public"."memo_direction" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."memo_lifecycle_state" AS ENUM('active', 'archived', 'recently_deleted', 'purging');--> statement-breakpoint
CREATE TYPE "public"."memo_origin" AS ENUM('manual', 'natural_language', 'voice');--> statement-breakpoint
CREATE TYPE "public"."memo_prior_lifecycle_state" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."memo_purpose" AS ENUM('personal', 'work', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."planning_status" AS ENUM('planned', 'unplanned');--> statement-breakpoint
CREATE TYPE "public"."provider_attempt_state" AS ENUM('started', 'succeeded', 'retryable_failed', 'terminal_failed', 'invalid_output');--> statement-breakpoint
CREATE TYPE "public"."provider_capability" AS ENUM('stt', 'extraction', 'email', 'provider_delete');--> statement-breakpoint
CREATE TYPE "public"."provider_error_class" AS ENUM('availability', 'timeout', 'rate_limited', 'invalid_request', 'invalid_response', 'policy', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."source_completeness" AS ENUM('complete', 'incomplete', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."account_deletion_state" AS ENUM('grace', 'canceled', 'purging', 'live_purged', 'provider_pending', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."background_job_state" AS ENUM('ready', 'leased', 'retry_wait', 'succeeded', 'dead');--> statement-breakpoint
CREATE TYPE "public"."background_job_type" AS ENUM('draft_expire', 'memo_purge', 'account_purge', 'export_build', 'export_delete', 'provider_delete', 'reconcile');--> statement-breakpoint
CREATE TYPE "public"."export_job_state" AS ENUM('queued', 'running', 'ready', 'failed', 'canceled', 'expired', 'deleting', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."idempotency_operation" AS ENUM('signup_side_effect', 'memo_create', 'draft_confirmation', 'export', 'memo_delete', 'account_delete');--> statement-breakpoint
CREATE TYPE "public"."idempotency_state" AS ENUM('in_progress', 'succeeded', 'failed_retryable', 'failed_final');--> statement-breakpoint
CREATE TYPE "public"."operation_failure_class" AS ENUM('availability', 'timeout', 'storage', 'provider', 'integrity', 'policy', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."provider_deletion_scope" AS ENUM('stt', 'ai', 'email', 'storage');--> statement-breakpoint
CREATE TYPE "public"."provider_deletion_state" AS ENUM('not_required', 'queued', 'requested', 'confirmed', 'pending_escalation', 'failed');--> statement-breakpoint
CREATE TYPE "public"."safe_response_code" AS ENUM('created', 'accepted', 'no_content', 'conflict', 'invalid_request', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('succeeded', 'conflict', 'denied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."currency_registry_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "category_kind" NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" "label_status" DEFAULT 'active' NOT NULL,
	"starter_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "categories_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "categories_name_length" CHECK (char_length("categories"."name") BETWEEN 1 AND 100),
	CONSTRAINT "categories_normalized_name_length" CHECK (char_length("categories"."normalized_name") BETWEEN 1 AND 100),
	CONSTRAINT "categories_revision_positive" CHECK ("categories"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "credential_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_accounts_owner_provider_unique" UNIQUE("user_id","provider"),
	CONSTRAINT "credential_accounts_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "credential_accounts_provider_credential" CHECK ("credential_accounts"."provider" = 'credential'),
	CONSTRAINT "credential_accounts_password_hash_nonempty" CHECK (length("credential_accounts"."password_hash") > 0)
);
--> statement-breakpoint
CREATE TABLE "money_spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" "label_status" DEFAULT 'active' NOT NULL,
	"starter_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "money_spaces_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "money_spaces_name_length" CHECK (char_length("money_spaces"."name") BETWEEN 1 AND 100),
	CONSTRAINT "money_spaces_normalized_name_length" CHECK (char_length("money_spaces"."normalized_name") BETWEEN 1 AND 100),
	CONSTRAINT "money_spaces_revision_positive" CHECK ("money_spaces"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_currency" text NOT NULL,
	"reporting_timezone" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "preferences_currency_code_format" CHECK ("preferences"."default_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "preferences_timezone_nonempty" CHECK (length("preferences"."reporting_timezone") BETWEEN 1 AND 255),
	CONSTRAINT "preferences_locale_nonempty" CHECK (length("preferences"."locale") BETWEEN 2 AND 35),
	CONSTRAINT "preferences_revision_positive" CHECK ("preferences"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"onboarding_state" "onboarding_state" DEFAULT 'not_started' NOT NULL,
	"privacy_notice_version" text,
	"privacy_notice_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "profiles_revision_positive" CHECK ("profiles"."revision" > 0),
	CONSTRAINT "profiles_privacy_acceptance_consistent" CHECK (("profiles"."privacy_notice_version" IS NULL) = ("profiles"."privacy_notice_accepted_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "reauth_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"scope" "reauth_scope"[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reauth_grants_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "reauth_grants_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "reauth_grants_scope_nonempty" CHECK (cardinality("reauth_grants"."scope") > 0),
	CONSTRAINT "reauth_grants_ten_minute_max" CHECK ("reauth_grants"."expires_at" > "reauth_grants"."created_at" AND "reauth_grants"."expires_at" <= "reauth_grants"."created_at" + interval '10 minutes')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token"),
	CONSTRAINT "sessions_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "sessions_expiry_after_create" CHECK ("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"status" "user_status" DEFAULT 'pending_verification' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_revision_positive" CHECK ("users"."revision" > 0),
	CONSTRAINT "users_verified_active_state" CHECK ("users"."status" NOT IN ('active', 'deletion_grace', 'purging') OR "users"."email_verified_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "verification_purpose" NOT NULL,
	"subject_hmac" "bytea" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "verification_tokens_subject_hmac_nonempty" CHECK (octet_length("verification_tokens"."subject_hmac") >= 32),
	CONSTRAINT "verification_tokens_token_hash_nonempty" CHECK (octet_length("verification_tokens"."token_hash") >= 32),
	CONSTRAINT "verification_tokens_expiry_after_create" CHECK ("verification_tokens"."expires_at" > "verification_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "assisted_captures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"mode" "capture_mode" NOT NULL,
	"state" "assisted_capture_state" DEFAULT 'editing' NOT NULL,
	"stt_consent_version" text,
	"ai_consent_version" text,
	"capture_started_at" timestamp with time zone NOT NULL,
	"last_error_code" "capture_error_code",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "assisted_captures_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "assisted_captures_revision_positive" CHECK ("assisted_captures"."revision" > 0),
	CONSTRAINT "assisted_captures_voice_consent" CHECK ("assisted_captures"."mode" <> 'voice' OR "assisted_captures"."state" IN ('editing', 'recording') OR "assisted_captures"."stt_consent_version" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "compose_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"origin" "memo_origin" NOT NULL,
	"source_text" text,
	"source_completeness" "source_completeness" NOT NULL,
	"candidate_fields" jsonb NOT NULL,
	"field_provenance" jsonb NOT NULL,
	"capture_started_at" timestamp with time zone NOT NULL,
	"capture_timezone" text NOT NULL,
	"status" "compose_draft_status" DEFAULT 'editing' NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "compose_drafts_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "compose_drafts_expiry_after_activity" CHECK ("compose_drafts"."expires_at" = "compose_drafts"."last_activity_at" + interval '7 days'),
	CONSTRAINT "compose_drafts_revision_positive" CHECK ("compose_drafts"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "money_memos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" "memo_direction" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"currency_exponent" smallint NOT NULL,
	"currency_registry_version" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"occurred_local" timestamp NOT NULL,
	"occurred_timezone" text NOT NULL,
	"occurred_offset_minutes" smallint NOT NULL,
	"timezone_database_version" text NOT NULL,
	"category_id" uuid,
	"money_space_id" uuid,
	"purpose" "memo_purpose",
	"planning_status" "planning_status",
	"note" text,
	"origin" "memo_origin" NOT NULL,
	"lifecycle_state" "memo_lifecycle_state" DEFAULT 'active' NOT NULL,
	"prior_lifecycle_state" "memo_prior_lifecycle_state",
	"deleted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "money_memos_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "money_memos_amount_positive" CHECK ("money_memos"."amount_minor" > 0),
	CONSTRAINT "money_memos_currency_code_format" CHECK ("money_memos"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "money_memos_currency_exponent_range" CHECK ("money_memos"."currency_exponent" BETWEEN 0 AND 3),
	CONSTRAINT "money_memos_offset_range" CHECK ("money_memos"."occurred_offset_minutes" BETWEEN -840 AND 840),
	CONSTRAINT "money_memos_note_length" CHECK ("money_memos"."note" IS NULL OR octet_length("money_memos"."note") <= 4000),
	CONSTRAINT "money_memos_revision_positive" CHECK ("money_memos"."revision" > 0),
	CONSTRAINT "money_memos_lifecycle_fields_consistent" CHECK ((
        "money_memos"."lifecycle_state" IN ('active', 'archived')
        AND "money_memos"."prior_lifecycle_state" IS NULL
        AND "money_memos"."deleted_at" IS NULL
        AND "money_memos"."purge_after" IS NULL
      ) OR (
        "money_memos"."lifecycle_state" = 'recently_deleted'
        AND "money_memos"."prior_lifecycle_state" IS NOT NULL
        AND "money_memos"."deleted_at" IS NOT NULL
        AND "money_memos"."purge_after" IS NOT NULL
        AND "money_memos"."purge_after" > "money_memos"."deleted_at"
      ) OR (
        "money_memos"."lifecycle_state" = 'purging'
        AND "money_memos"."prior_lifecycle_state" IS NOT NULL
        AND "money_memos"."deleted_at" IS NOT NULL
        AND "money_memos"."purge_after" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "provider_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"capture_id" uuid NOT NULL,
	"capability" "provider_capability" NOT NULL,
	"provider_decision_version" text NOT NULL,
	"provider_request_id_hmac" "bytea",
	"state" "provider_attempt_state" NOT NULL,
	"attempt_number" smallint NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"error_class" "provider_error_class",
	CONSTRAINT "provider_attempts_attempt_range" CHECK ("provider_attempts"."attempt_number" BETWEEN 1 AND 10),
	CONSTRAINT "provider_attempts_terminal_finished" CHECK ("provider_attempts"."state" = 'started' OR "provider_attempts"."finished_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "temporary_audio_metadata" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"capture_id" uuid NOT NULL,
	"owner_instance_hmac" "bytea" NOT NULL,
	"storage_kind" "audio_storage_kind" NOT NULL,
	"state" "audio_state" NOT NULL,
	"byte_size" integer,
	"declared_media_type" "audio_media_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_reason" "audio_deletion_reason",
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "temporary_audio_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "temporary_audio_size_range" CHECK ("temporary_audio_metadata"."byte_size" IS NULL OR "temporary_audio_metadata"."byte_size" BETWEEN 0 AND 10485760),
	CONSTRAINT "temporary_audio_expiry_within_hour" CHECK ("temporary_audio_metadata"."expires_at" > "temporary_audio_metadata"."created_at" AND "temporary_audio_metadata"."expires_at" <= "temporary_audio_metadata"."created_at" + interval '1 hour'),
	CONSTRAINT "temporary_audio_revision_positive" CHECK ("temporary_audio_metadata"."revision" > 0),
	CONSTRAINT "temporary_audio_terminal_metadata" CHECK ("temporary_audio_metadata"."state" NOT IN ('deleted', 'expired') OR ("temporary_audio_metadata"."deleted_at" IS NOT NULL AND "temporary_audio_metadata"."deletion_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "account_deletions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"state" "account_deletion_state" DEFAULT 'grace' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"grace_ends_at" timestamp with time zone NOT NULL,
	"irreversible_at" timestamp with time zone,
	"live_purge_due_at" timestamp with time zone,
	"live_purged_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_class" "operation_failure_class",
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "account_deletions_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "account_deletions_seven_day_grace" CHECK ("account_deletions"."grace_ends_at" = "account_deletions"."requested_at" + interval '7 days'),
	CONSTRAINT "account_deletions_revision_positive" CHECK ("account_deletions"."revision" > 0),
	CONSTRAINT "account_deletions_irreversible_fields" CHECK ("account_deletions"."state" IN ('grace', 'canceled') OR "account_deletions"."irreversible_at" IS NOT NULL),
	CONSTRAINT "account_deletions_live_purge_due_bound" CHECK ("account_deletions"."live_purge_due_at" IS NULL OR "account_deletions"."live_purge_due_at" <= "account_deletions"."grace_ends_at" + interval '24 hours'),
	CONSTRAINT "account_deletions_complete_fields" CHECK ("account_deletions"."state" <> 'complete' OR ("account_deletions"."live_purged_at" IS NOT NULL AND "account_deletions"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id_hmac" "bytea",
	"job_type" "background_job_type" NOT NULL,
	"dedupe_key" text NOT NULL,
	"state" "background_job_state" DEFAULT 'ready' NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"leased_until" timestamp with time zone,
	"lease_owner" uuid,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint NOT NULL,
	"last_error_class" "operation_failure_class",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_jobs_attempt_range" CHECK ("background_jobs"."attempts" BETWEEN 0 AND "background_jobs"."max_attempts" AND "background_jobs"."max_attempts" > 0),
	CONSTRAINT "background_jobs_lease_consistent" CHECK ("background_jobs"."state" <> 'leased' OR ("background_jobs"."leased_until" IS NOT NULL AND "background_jobs"."lease_owner" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"schema_version" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"state" "export_job_state" DEFAULT 'queued' NOT NULL,
	"snapshot_cutoff" timestamp with time zone NOT NULL,
	"object_key_ciphertext" "bytea",
	"manifest_sha256" "bytea",
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"failure_class" "operation_failure_class",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "export_jobs_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "export_jobs_revision_positive" CHECK ("export_jobs"."revision" > 0),
	CONSTRAINT "export_jobs_ready_fields_consistent" CHECK ("export_jobs"."state" <> 'ready' OR (
        "export_jobs"."object_key_ciphertext" IS NOT NULL
        AND "export_jobs"."manifest_sha256" IS NOT NULL
        AND "export_jobs"."ready_at" IS NOT NULL
        AND "export_jobs"."expires_at" IS NOT NULL
        AND "export_jobs"."expires_at" <= "export_jobs"."ready_at" + interval '24 hours'
      ))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" "idempotency_operation" NOT NULL,
	"key" uuid NOT NULL,
	"request_hmac" "bytea" NOT NULL,
	"state" "idempotency_state" NOT NULL,
	"result_type" text,
	"result_id" uuid,
	"result_revision" bigint,
	"response_code" "safe_response_code",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_expiry_after_create" CHECK ("idempotency_records"."expires_at" > "idempotency_records"."created_at" AND "idempotency_records"."expires_at" <= "idempotency_records"."created_at" + interval '35 days'),
	CONSTRAINT "idempotency_records_result_consistent" CHECK (("idempotency_records"."result_type" IS NULL AND "idempotency_records"."result_id" IS NULL AND "idempotency_records"."result_revision" IS NULL)
        OR ("idempotency_records"."result_type" IS NOT NULL AND "idempotency_records"."result_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "provider_deletions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_deletion_id" uuid NOT NULL,
	"provider_decision_version" text NOT NULL,
	"scope" "provider_deletion_scope" NOT NULL,
	"state" "provider_deletion_state" NOT NULL,
	"provider_reference_hmac" "bytea",
	"requested_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"failure_class" "operation_failure_class",
	CONSTRAINT "provider_deletions_owner_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "provider_deletions_request_scope_unique" UNIQUE("account_deletion_id","scope"),
	CONSTRAINT "provider_deletions_attempt_range" CHECK ("provider_deletions"."attempts" BETWEEN 0 AND 100),
	CONSTRAINT "provider_deletions_confirmation_consistent" CHECK ("provider_deletions"."state" <> 'confirmed' OR "provider_deletions"."confirmed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "content_free_mutation_audits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_hmac" "bytea" NOT NULL,
	"actor_session_hmac" "bytea" NOT NULL,
	"operation" text NOT NULL,
	"from_revision" bigint,
	"to_revision" bigint,
	"result" "audit_result" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "content_free_audits_subject_hmac_length" CHECK (octet_length("content_free_mutation_audits"."subject_hmac") = 32),
	CONSTRAINT "content_free_audits_actor_hmac_length" CHECK (octet_length("content_free_mutation_audits"."actor_session_hmac") = 32),
	CONSTRAINT "content_free_audits_operation_nonempty" CHECK (length("content_free_mutation_audits"."operation") > 0),
	CONSTRAINT "content_free_audits_revision_order" CHECK ("content_free_mutation_audits"."from_revision" IS NULL OR "content_free_mutation_audits"."to_revision" IS NULL OR "content_free_mutation_audits"."to_revision" >= "content_free_mutation_audits"."from_revision"),
	CONSTRAINT "content_free_audits_retention_bound" CHECK ("content_free_mutation_audits"."expires_at" > "content_free_mutation_audits"."occurred_at" AND "content_free_mutation_audits"."expires_at" <= "content_free_mutation_audits"."occurred_at" + interval '35 days')
);
--> statement-breakpoint
CREATE TABLE "currency_registry_entries" (
	"registry_version" text NOT NULL,
	"code" text NOT NULL,
	"exponent" smallint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"display_name_key" text NOT NULL,
	CONSTRAINT "currency_registry_entries_registry_version_code_pk" PRIMARY KEY("registry_version","code"),
	CONSTRAINT "currency_registry_entries_code_format" CHECK ("currency_registry_entries"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currency_registry_entries_exponent_range" CHECK ("currency_registry_entries"."exponent" BETWEEN 0 AND 3),
	CONSTRAINT "currency_registry_entries_display_key_nonempty" CHECK (length("currency_registry_entries"."display_name_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "currency_registry_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"source_cldr_version" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"source_sha256" "bytea" NOT NULL,
	"status" "currency_registry_status" NOT NULL,
	CONSTRAINT "currency_registry_versions_name_nonempty" CHECK (length("currency_registry_versions"."version") > 0),
	CONSTRAINT "currency_registry_versions_source_nonempty" CHECK (length("currency_registry_versions"."source_cldr_version") > 0),
	CONSTRAINT "currency_registry_versions_sha256_length" CHECK (octet_length("currency_registry_versions"."source_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "history_list_states" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "history_list_states_positive_version" CHECK ("history_list_states"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_accounts" ADD CONSTRAINT "credential_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_spaces" ADD CONSTRAINT "money_spaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reauth_grants" ADD CONSTRAINT "reauth_grants_owned_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assisted_captures" ADD CONSTRAINT "assisted_captures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assisted_captures" ADD CONSTRAINT "assisted_captures_owned_draft_fk" FOREIGN KEY ("user_id","draft_id") REFERENCES "public"."compose_drafts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose_drafts" ADD CONSTRAINT "compose_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_memos" ADD CONSTRAINT "money_memos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_memos" ADD CONSTRAINT "money_memos_owned_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_memos" ADD CONSTRAINT "money_memos_owned_money_space_fk" FOREIGN KEY ("user_id","money_space_id") REFERENCES "public"."money_spaces"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_owned_capture_fk" FOREIGN KEY ("user_id","capture_id") REFERENCES "public"."assisted_captures"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_audio_metadata" ADD CONSTRAINT "temporary_audio_metadata_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_audio_metadata" ADD CONSTRAINT "temporary_audio_owned_capture_fk" FOREIGN KEY ("user_id","capture_id") REFERENCES "public"."assisted_captures"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletions" ADD CONSTRAINT "account_deletions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_deletions" ADD CONSTRAINT "provider_deletions_owned_account_deletion_fk" FOREIGN KEY ("user_id","account_deletion_id") REFERENCES "public"."account_deletions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_registry_entries" ADD CONSTRAINT "currency_registry_entries_version_fk" FOREIGN KEY ("registry_version") REFERENCES "public"."currency_registry_versions"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_list_states" ADD CONSTRAINT "history_list_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_active_name_unique" ON "categories" USING btree ("user_id","kind","normalized_name") WHERE "categories"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "categories_starter_key_unique" ON "categories" USING btree ("user_id","starter_key") WHERE "categories"."starter_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "categories_owner_status_idx" ON "categories" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "credential_accounts_owner_idx" ON "credential_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "money_spaces_active_name_unique" ON "money_spaces" USING btree ("user_id","normalized_name") WHERE "money_spaces"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "money_spaces_starter_key_unique" ON "money_spaces" USING btree ("user_id","starter_key") WHERE "money_spaces"."starter_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "money_spaces_owner_status_idx" ON "money_spaces" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "reauth_grants_owner_expiry_idx" ON "reauth_grants" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "sessions_owner_expiry_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "verification_tokens_subject_purpose_idx" ON "verification_tokens" USING btree ("subject_hmac","purpose");--> statement-breakpoint
CREATE INDEX "verification_tokens_expiry_idx" ON "verification_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "assisted_captures_owner_state_idx" ON "assisted_captures" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "compose_drafts_owner_activity_idx" ON "compose_drafts" USING btree ("user_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "compose_drafts_expiry_idx" ON "compose_drafts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "money_memos_history_order_idx" ON "money_memos" USING btree ("user_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "money_memos_lifecycle_history_idx" ON "money_memos" USING btree ("user_id","lifecycle_state","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "money_memos_category_history_idx" ON "money_memos" USING btree ("user_id","category_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "money_memos_space_history_idx" ON "money_memos" USING btree ("user_id","money_space_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "money_memos_direction_currency_idx" ON "money_memos" USING btree ("user_id","direction","currency_code","occurred_at");--> statement-breakpoint
CREATE INDEX "money_memos_note_search_idx" ON "money_memos" USING gin (to_tsvector('simple', coalesce("note", '')));--> statement-breakpoint
CREATE INDEX "money_memos_purge_due_idx" ON "money_memos" USING btree ("user_id","purge_after") WHERE "money_memos"."lifecycle_state" IN ('recently_deleted', 'purging');--> statement-breakpoint
CREATE INDEX "provider_attempts_capture_capability_idx" ON "provider_attempts" USING btree ("user_id","capture_id","capability","attempt_number");--> statement-breakpoint
CREATE INDEX "temporary_audio_expiry_idx" ON "temporary_audio_metadata" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "temporary_audio_owner_capture_idx" ON "temporary_audio_metadata" USING btree ("user_id","capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletions_one_current_per_owner" ON "account_deletions" USING btree ("user_id") WHERE "account_deletions"."state" NOT IN ('canceled', 'complete');--> statement-breakpoint
CREATE INDEX "account_deletions_state_due_idx" ON "account_deletions" USING btree ("state","grace_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_type_dedupe_unique" ON "background_jobs" USING btree ("job_type","dedupe_key");--> statement-breakpoint
CREATE INDEX "background_jobs_claim_idx" ON "background_jobs" USING btree ("state","available_at");--> statement-breakpoint
CREATE INDEX "background_jobs_lease_reclaim_idx" ON "background_jobs" USING btree ("state","leased_until");--> statement-breakpoint
CREATE INDEX "export_jobs_owner_state_idx" ON "export_jobs" USING btree ("user_id","state","requested_at");--> statement-breakpoint
CREATE INDEX "export_jobs_expiry_idx" ON "export_jobs" USING btree ("state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_owner_operation_key_unique" ON "idempotency_records" USING btree ("user_id","operation","key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "provider_deletions_state_check_idx" ON "provider_deletions" USING btree ("state","next_check_at");--> statement-breakpoint
CREATE INDEX "content_free_audits_expiry_idx" ON "content_free_mutation_audits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "currency_registry_entries_enabled_idx" ON "currency_registry_entries" USING btree ("enabled","code");--> statement-breakpoint
CREATE INDEX "currency_registry_versions_status_idx" ON "currency_registry_versions" USING btree ("status");
