ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT pg_catalog.gen_random_uuid();--> statement-breakpoint
UPDATE "users"
SET
  "name" = 'Cashmemo account',
  "email" = lower("email"::text),
  "email_verified" = ("email_verified_at" IS NOT NULL),
  "status" = CASE
    WHEN "status" = 'pending_verification' AND "email_verified_at" IS NOT NULL THEN 'active'::"user_status"
    ELSE "status"
  END;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_verified_active_state";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" TYPE text USING lower("email"::text);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email_verified" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email_verified_at";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_name_compatibility" CHECK ("users"."name" = 'Cashmemo account');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower("users"."email"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_verified_active_state" CHECK ("users"."status" NOT IN ('active', 'deletion_grace', 'purging') OR "users"."email_verified" = true);--> statement-breakpoint

ALTER TABLE "credential_accounts" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "credential_accounts" ADD COLUMN "access_token" text;--> statement-breakpoint
ALTER TABLE "credential_accounts" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "credential_accounts" ADD COLUMN "id_token" text;--> statement-breakpoint
ALTER TABLE "credential_accounts" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credential_accounts" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credential_accounts" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "credential_accounts" ALTER COLUMN "id" SET DEFAULT pg_catalog.gen_random_uuid();--> statement-breakpoint
UPDATE "credential_accounts" SET "account_id" = "user_id"::text;--> statement-breakpoint
ALTER TABLE "credential_accounts" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_accounts" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_accounts" DROP CONSTRAINT "credential_accounts_password_hash_nonempty";--> statement-breakpoint
ALTER TABLE "credential_accounts" DROP COLUMN "password_changed_at";--> statement-breakpoint
ALTER TABLE "credential_accounts" ADD CONSTRAINT "credential_accounts_account_id_nonempty" CHECK (length("credential_accounts"."account_id") > 0);--> statement-breakpoint
ALTER TABLE "credential_accounts" ADD CONSTRAINT "credential_accounts_password_hash_nonempty" CHECK ("credential_accounts"."provider" <> 'credential' OR ("credential_accounts"."password_hash" IS NOT NULL AND length("credential_accounts"."password_hash") > 0));--> statement-breakpoint
ALTER TABLE "credential_accounts" ADD CONSTRAINT "credential_accounts_credential_oauth_fields_null" CHECK ("credential_accounts"."provider" <> 'credential' OR ("credential_accounts"."access_token" IS NULL AND "credential_accounts"."refresh_token" IS NULL AND "credential_accounts"."id_token" IS NULL AND "credential_accounts"."access_token_expires_at" IS NULL AND "credential_accounts"."refresh_token_expires_at" IS NULL AND "credential_accounts"."scope" IS NULL));--> statement-breakpoint

TRUNCATE TABLE "verification_tokens";--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "id" SET DEFAULT pg_catalog.gen_random_uuid();--> statement-breakpoint
ALTER TABLE "verification_tokens" ALTER COLUMN "id" SET DEFAULT pg_catalog.gen_random_uuid();--> statement-breakpoint
ALTER TABLE "verification_tokens" DROP CONSTRAINT "verification_tokens_token_hash_unique";--> statement-breakpoint
ALTER TABLE "verification_tokens" DROP CONSTRAINT "verification_tokens_subject_hmac_nonempty";--> statement-breakpoint
ALTER TABLE "verification_tokens" DROP CONSTRAINT "verification_tokens_token_hash_nonempty";--> statement-breakpoint
ALTER TABLE "verification_tokens" DROP CONSTRAINT "verification_tokens_expiry_after_create";--> statement-breakpoint
DROP INDEX "verification_tokens_subject_purpose_idx";--> statement-breakpoint
DROP INDEX "verification_tokens_expiry_idx";--> statement-breakpoint
ALTER TABLE "verification_tokens" DROP COLUMN "purpose";--> statement-breakpoint
ALTER TABLE "verification_tokens" DROP COLUMN "subject_hmac";--> statement-breakpoint
ALTER TABLE "verification_tokens" DROP COLUMN "token_hash";--> statement-breakpoint
ALTER TABLE "verification_tokens" DROP COLUMN "used_at";--> statement-breakpoint
DROP TYPE "public"."verification_purpose";--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD COLUMN "identifier" text NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD COLUMN "value" text NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_identifier_nonempty" CHECK (char_length("verification_tokens"."identifier") = 43);--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_value_nonempty" CHECK ("verification_tokens"."value" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_expiry_after_create" CHECK ("verification_tokens"."expires_at" > "verification_tokens"."created_at");--> statement-breakpoint
CREATE INDEX "verification_tokens_identifier_idx" ON "verification_tokens" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_tokens_expiry_idx" ON "verification_tokens" USING btree ("expires_at");
