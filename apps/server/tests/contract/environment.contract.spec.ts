import { describe, expect, it } from "vitest";

import {
  EnvironmentConfigurationError,
  parseEnvironment,
} from "../../src/bootstrap/environment.schema.js";

const base = (): NodeJS.ProcessEnv => ({
  APP_ENV: "test",
  APP_ORIGIN: "http://localhost:3000",
  ASSISTED_CAPTURE_MODE: "disabled",
  AUTH_DATABASE_URL: "postgresql://identity:synthetic@postgres:5432/cashmemo",
  AUTH_SESSION_SECRET: "a".repeat(32),
  AUTH_TOKEN_HMAC_KEY: "b".repeat(32),
  BACKUP_MODE: "contract",
  BUILD_VERSION: "test",
  CURRENCY_REGISTRY_VERSION: "synthetic-v1",
  DATABASE_URL: "postgresql://runtime:synthetic@postgres:5432/cashmemo",
  DELETION_SUPPRESSION_HMAC_KEY: "c".repeat(32),
  EMAIL_FROM_ADDRESS: "noreply@cashmemo.test",
  EMAIL_PROVIDER: "disabled",
  EVIDENCE_HMAC_KEY: "d".repeat(32),
  EXTRACTION_MODEL_SNAPSHOT: "gpt-5.4-mini-2026-03-17",
  OBJECT_STORAGE_MODE: "contract",
  PASSWORD_PEPPER: "e".repeat(32),
  PORT: "3000",
  PROCESS_ROLE: "api",
  PROVIDER_DECISION_VERSION: "synthetic-v1",
  SECRET_DELIVERY_MODE: "injected_environment",
  STT_MODEL_SNAPSHOT: "gpt-4o-mini-transcribe-2025-12-15",
  TZDB_VERSION: "2026a",
});

describe("canonical runtime environment", () => {
  it("supports contract providers in test without external credentials", () => {
    expect(parseEnvironment(base())).toMatchObject({
      BACKUP_MODE: "contract",
      OBJECT_STORAGE_MODE: "contract",
      SECRET_DELIVERY_MODE: "injected_environment",
    });
  });

  it("fails production closed on missing RustFS, pgBackRest, Cloudflare, and OTLP", () => {
    const source = { ...base(), APP_ENV: "production", APP_ORIGIN: "https://cashmemo.test" };
    const error = (() => {
      try {
        parseEnvironment(source);
      } catch (reason) {
        return reason;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(EnvironmentConfigurationError);
    expect((error as EnvironmentConfigurationError).invalidNames).toEqual(
      expect.arrayContaining([
        "BACKUP_MODE",
        "EMAIL_PROVIDER",
        "OBJECT_STORAGE_MODE",
        "OTEL_EXPORTER_OTLP_ENDPOINT",
      ]),
    );
    expect((error as Error).message).not.toContain("postgresql://");
  });

  it("accepts a complete production-equivalent self-hosted binding", () => {
    expect(
      parseEnvironment({
        ...base(),
        APP_ENV: "production",
        APP_ORIGIN: "https://cashmemo.test",
        BACKUP_MODE: "pgbackrest",
        CLOUDFLARE_ACCOUNT_ID: "synthetic-account",
        CLOUDFLARE_EMAIL_API_TOKEN: "f".repeat(32),
        DELETION_LEDGER_NAMESPACE: "cashmemo/deletion-ledger",
        EMAIL_PROVIDER: "cloudflare",
        OBJECT_STORAGE_MODE: "rustfs",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318",
        PGBACKREST_REPOSITORY_PREFIX: "cashmemo/pgbackrest",
        PGBACKREST_STANZA: "cashmemo",
        RUSTFS_EVIDENCE_BUCKET: "cashmemo-evidence",
        RUSTFS_EXPORT_BUCKET: "cashmemo-exports",
        RUSTFS_PRIMARY_ACCESS_KEY: "synthetic-primary",
        RUSTFS_PRIMARY_ENDPOINT: "http://rustfs-primary:9000",
        RUSTFS_PRIMARY_REGION: "us-east-1",
        RUSTFS_PRIMARY_SECRET_KEY: "g".repeat(32),
        RUSTFS_PRIMARY_STORAGE_POLICY_VERSION: "cashmemo-rustfs-encrypted-v1",
        RUSTFS_SECONDARY_ACCESS_KEY: "synthetic-secondary",
        RUSTFS_SECONDARY_BUCKET: "cashmemo-backup",
        RUSTFS_SECONDARY_ENDPOINT: "http://rustfs-secondary:9000",
        RUSTFS_SECONDARY_REGION: "us-east-1",
        RUSTFS_SECONDARY_SECRET_KEY: "h".repeat(32),
        RUSTFS_SECONDARY_STORAGE_POLICY_VERSION: "cashmemo-rustfs-encrypted-v1",
      }),
    ).toMatchObject({
      BACKUP_MODE: "pgbackrest",
      EMAIL_PROVIDER: "cloudflare",
      OBJECT_STORAGE_MODE: "rustfs",
    });
  });
});
