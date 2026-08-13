import { z } from "zod";

const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);
const optional = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(emptyToUndefined, schema.optional());

const nonEmpty = z.string().trim().min(1);
const opaqueSecret = z.string().min(32).max(4096);
const serviceUrl = z.url().refine((value) => {
  const parsed = new URL(value);
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === ""
  );
}, "SERVICE_URL_REQUIRED");
const httpsUrl = serviceUrl.refine((value) => value.startsWith("https://"), "HTTPS_REQUIRED");
const postgresUrl = z
  .url()
  .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
    message: "POSTGRESQL_URL_REQUIRED",
  });
const bucketName = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u, "INVALID_BUCKET_NAME");
const namespace = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9/_-]*$/u, "INVALID_NAMESPACE");

const environmentSchema = z
  .object({
    APP_ENV: z.enum(["local", "test", "development", "staging", "production"]),
    APP_ORIGIN: z.url(),
    BUILD_VERSION: nonEmpty.max(128),
    PROCESS_ROLE: z.enum(["api", "worker", "all"]),
    PORT: z.coerce.number().int().min(1).max(65_535),

    DATABASE_URL: postgresUrl,
    AUTH_DATABASE_URL: postgresUrl,
    AUTH_SESSION_SECRET: opaqueSecret,
    AUTH_TOKEN_HMAC_KEY: opaqueSecret,
    PASSWORD_PEPPER: opaqueSecret,
    EVIDENCE_HMAC_KEY: opaqueSecret,
    DELETION_SUPPRESSION_HMAC_KEY: opaqueSecret,
    SECRET_DELIVERY_MODE: z.literal("injected_environment"),

    OBJECT_STORAGE_MODE: z.enum(["disabled", "contract", "rustfs"]),
    RUSTFS_PRIMARY_ENDPOINT: optional(serviceUrl),
    RUSTFS_PRIMARY_REGION: optional(nonEmpty.max(64)),
    RUSTFS_PRIMARY_ACCESS_KEY: optional(nonEmpty.max(256)),
    RUSTFS_PRIMARY_SECRET_KEY: optional(opaqueSecret),
    RUSTFS_PRIMARY_STORAGE_POLICY_VERSION: optional(z.literal("cashmemo-rustfs-encrypted-v1")),
    RUSTFS_EXPORT_BUCKET: optional(bucketName),
    RUSTFS_EVIDENCE_BUCKET: optional(bucketName),

    BACKUP_MODE: z.enum(["disabled", "contract", "pgbackrest"]),
    RUSTFS_SECONDARY_ENDPOINT: optional(serviceUrl),
    RUSTFS_SECONDARY_REGION: optional(nonEmpty.max(64)),
    RUSTFS_SECONDARY_ACCESS_KEY: optional(nonEmpty.max(256)),
    RUSTFS_SECONDARY_SECRET_KEY: optional(opaqueSecret),
    RUSTFS_SECONDARY_STORAGE_POLICY_VERSION: optional(z.literal("cashmemo-rustfs-encrypted-v1")),
    RUSTFS_SECONDARY_BUCKET: optional(bucketName),
    PGBACKREST_STANZA: optional(namespace),
    PGBACKREST_REPOSITORY_PREFIX: optional(namespace),
    DELETION_LEDGER_NAMESPACE: optional(namespace),

    EMAIL_PROVIDER: z.enum(["disabled", "mailpit", "cloudflare"]),
    EMAIL_FROM_ADDRESS: z.email(),
    MAILPIT_API_URL: optional(serviceUrl),
    CLOUDFLARE_ACCOUNT_ID: optional(nonEmpty.max(128)),
    CLOUDFLARE_EMAIL_API_TOKEN: optional(opaqueSecret),
    CLOUDFLARE_EMAIL_BASE_URL: optional(z.literal("https://api.cloudflare.com/client/v4")).default(
      "https://api.cloudflare.com/client/v4",
    ),

    ASSISTED_CAPTURE_MODE: z.enum(["disabled", "fake", "openai"]),
    OPENAI_API_KEY: optional(nonEmpty.max(4096)),
    OPENAI_PROJECT_ID: optional(nonEmpty.max(256)),
    OPENAI_BASE_URL: optional(httpsUrl),
    STT_MODEL_SNAPSHOT: z.literal("gpt-4o-mini-transcribe-2025-12-15"),
    EXTRACTION_MODEL_SNAPSHOT: z.literal("gpt-5.4-mini-2026-03-17"),
    PROVIDER_DECISION_VERSION: nonEmpty.max(128),

    CURRENCY_REGISTRY_VERSION: nonEmpty.max(128),
    TZDB_VERSION: nonEmpty.max(64),
    OTEL_EXPORTER_OTLP_ENDPOINT: optional(serviceUrl),
  })
  .superRefine((environment, context) => {
    const hosted = new Set(["development", "staging", "production"]).has(environment.APP_ENV);
    const productionEquivalent =
      environment.APP_ENV === "staging" || environment.APP_ENV === "production";

    if (hosted && !environment.APP_ORIGIN.startsWith("https://")) {
      context.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "HTTPS_REQUIRED" });
    }

    const requireFields = (fields: readonly (keyof typeof environment)[], message: string) => {
      for (const field of fields) {
        if (environment[field] === undefined) {
          context.addIssue({ code: "custom", path: [field], message });
        }
      }
    };

    if (environment.OBJECT_STORAGE_MODE === "rustfs") {
      requireFields(
        [
          "RUSTFS_PRIMARY_ENDPOINT",
          "RUSTFS_PRIMARY_REGION",
          "RUSTFS_PRIMARY_ACCESS_KEY",
          "RUSTFS_PRIMARY_SECRET_KEY",
          "RUSTFS_PRIMARY_STORAGE_POLICY_VERSION",
          "RUSTFS_EXPORT_BUCKET",
          "RUSTFS_EVIDENCE_BUCKET",
        ],
        "REQUIRED_FOR_RUSTFS_PRIMARY",
      );
    }

    if (environment.BACKUP_MODE === "pgbackrest") {
      requireFields(
        [
          "RUSTFS_SECONDARY_ENDPOINT",
          "RUSTFS_SECONDARY_REGION",
          "RUSTFS_SECONDARY_ACCESS_KEY",
          "RUSTFS_SECONDARY_SECRET_KEY",
          "RUSTFS_SECONDARY_STORAGE_POLICY_VERSION",
          "RUSTFS_SECONDARY_BUCKET",
          "PGBACKREST_STANZA",
          "PGBACKREST_REPOSITORY_PREFIX",
          "DELETION_LEDGER_NAMESPACE",
        ],
        "REQUIRED_FOR_PGBACKREST_SECONDARY",
      );
    }

    if (environment.EMAIL_PROVIDER === "mailpit") {
      requireFields(["MAILPIT_API_URL"], "REQUIRED_FOR_MAILPIT");
    }
    if (environment.EMAIL_PROVIDER === "cloudflare") {
      requireFields(
        ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_EMAIL_API_TOKEN"],
        "REQUIRED_FOR_CLOUDFLARE_EMAIL",
      );
    }

    if (environment.ASSISTED_CAPTURE_MODE === "openai") {
      requireFields(
        ["OPENAI_API_KEY", "OPENAI_PROJECT_ID", "OPENAI_BASE_URL"],
        "REQUIRED_FOR_OPENAI",
      );
    }

    if (hosted) {
      if (environment.OBJECT_STORAGE_MODE !== "rustfs") {
        context.addIssue({
          code: "custom",
          path: ["OBJECT_STORAGE_MODE"],
          message: "RUSTFS_REQUIRED_IN_PRODUCTION_EQUIVALENT_ENVIRONMENT",
        });
      }
      if (environment.BACKUP_MODE !== "pgbackrest") {
        context.addIssue({
          code: "custom",
          path: ["BACKUP_MODE"],
          message: "PGBACKREST_REQUIRED_IN_PRODUCTION_EQUIVALENT_ENVIRONMENT",
        });
      }
      if (productionEquivalent && environment.EMAIL_PROVIDER !== "cloudflare") {
        context.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER"],
          message: "CLOUDFLARE_EMAIL_REQUIRED_IN_PRODUCTION_EQUIVALENT_ENVIRONMENT",
        });
      }
      if (environment.OTEL_EXPORTER_OTLP_ENDPOINT === undefined) {
        context.addIssue({
          code: "custom",
          path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
          message: "REQUIRED_IN_PRODUCTION_EQUIVALENT_ENVIRONMENT",
        });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

const workerEnvironmentSchema = z.object({
  APP_ENV: z.enum(["local", "test", "development", "staging", "production"]),
  BUILD_VERSION: nonEmpty.max(128),
  DATABASE_URL: postgresUrl,
  PORT: z.coerce.number().int().min(1).max(65_535),
  PROCESS_ROLE: z.literal("worker"),
  SECRET_DELIVERY_MODE: z.literal("injected_environment"),
  AUTH_DATABASE_URL: z.never().optional(),
  AUTH_SESSION_SECRET: z.never().optional(),
  AUTH_TOKEN_HMAC_KEY: z.never().optional(),
  PASSWORD_PEPPER: z.never().optional(),
  CLOUDFLARE_EMAIL_API_TOKEN: z.never().optional(),
  OPENAI_API_KEY: z.never().optional(),
  RUSTFS_PRIMARY_SECRET_KEY: z.never().optional(),
  RUSTFS_SECONDARY_SECRET_KEY: z.never().optional(),
  PGBACKREST_REPOSITORY_CIPHER_PASS: z.never().optional(),
});

export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export class EnvironmentConfigurationError extends Error {
  readonly invalidNames: readonly string[];

  constructor(invalidNames: readonly string[]) {
    super(`Invalid runtime configuration names: ${invalidNames.join(", ")}`);
    this.name = "EnvironmentConfigurationError";
    this.invalidNames = invalidNames;
  }
}

export const parseEnvironment = (source: NodeJS.ProcessEnv): Environment => {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const invalidNames = [
      ...new Set(
        result.error.issues.map((issue) =>
          issue.path.length === 0 ? "ENVIRONMENT" : String(issue.path[0]),
        ),
      ),
    ].sort();
    throw new EnvironmentConfigurationError(invalidNames);
  }
  return result.data;
};

export const parseWorkerEnvironment = (source: NodeJS.ProcessEnv): WorkerEnvironment => {
  const result = workerEnvironmentSchema.safeParse(source);
  if (!result.success) {
    const invalidNames = [
      ...new Set(
        result.error.issues.map((issue) =>
          issue.path.length === 0 ? "ENVIRONMENT" : String(issue.path[0]),
        ),
      ),
    ].sort();
    throw new EnvironmentConfigurationError(invalidNames);
  }
  return result.data;
};
