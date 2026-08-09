import { z } from "zod";

const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);
const optional = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(emptyToUndefined, schema.optional());

const nonEmpty = z.string().trim().min(1);
const opaqueSecret = z.string().min(32).max(4096);
const httpsUrl = z.url().refine((value) => value.startsWith("https://"), "HTTPS_REQUIRED");
const bucketName = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u, "INVALID_BUCKET_NAME");
const kmsArn = z
  .string()
  .regex(/^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[0-9a-f-]+$/u, "INVALID_KMS_ARN");

const environmentSchema = z
  .object({
    APP_ENV: z.enum(["local", "test", "staging", "production"]),
    APP_ORIGIN: z.url(),
    BUILD_VERSION: nonEmpty.max(128),
    PROCESS_ROLE: z.enum(["api", "worker", "all"]),
    PORT: z.coerce.number().int().min(1).max(65_535),

    DATABASE_URL: z
      .url()
      .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
        message: "POSTGRESQL_URL_REQUIRED",
      }),
    AUTH_SESSION_SECRET: opaqueSecret,
    AUTH_TOKEN_HMAC_KEY: opaqueSecret,
    PASSWORD_PEPPER: opaqueSecret,
    EVIDENCE_HMAC_KEY: opaqueSecret,
    DELETION_SUPPRESSION_HMAC_KEY: opaqueSecret,

    AWS_REGION: nonEmpty.max(32),
    EXPORT_BUCKET: bucketName,
    EVIDENCE_BUCKET: bucketName,
    DELETION_LEDGER_BUCKET: bucketName,
    KMS_EXPORT_KEY_ARN: kmsArn,
    KMS_EVIDENCE_KEY_ARN: kmsArn,
    SES_FROM_ADDRESS: z.email(),

    ASSISTED_CAPTURE_MODE: z.enum(["disabled", "fake", "openai"]),
    OPENAI_API_KEY: optional(nonEmpty.max(4096)),
    OPENAI_PROJECT_ID: optional(nonEmpty.max(256)),
    OPENAI_BASE_URL: optional(httpsUrl),
    STT_MODEL_SNAPSHOT: z.literal("gpt-4o-mini-transcribe-2025-12-15"),
    EXTRACTION_MODEL_SNAPSHOT: z.literal("gpt-5.4-mini-2026-03-17"),
    PROVIDER_DECISION_VERSION: nonEmpty.max(128),

    CURRENCY_REGISTRY_VERSION: nonEmpty.max(128),
    TZDB_VERSION: nonEmpty.max(64),
    OTEL_EXPORTER_OTLP_ENDPOINT: optional(httpsUrl),
  })
  .superRefine((environment, context) => {
    const productionEquivalent =
      environment.APP_ENV === "staging" || environment.APP_ENV === "production";

    if (productionEquivalent && !environment.APP_ORIGIN.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "HTTPS_REQUIRED",
      });
    }

    if (productionEquivalent && environment.AWS_REGION !== "ap-southeast-1") {
      context.addIssue({
        code: "custom",
        path: ["AWS_REGION"],
        message: "APPROVED_REGION_REQUIRED",
      });
    }

    if (environment.ASSISTED_CAPTURE_MODE === "openai") {
      for (const field of ["OPENAI_API_KEY", "OPENAI_PROJECT_ID", "OPENAI_BASE_URL"] as const) {
        if (environment[field] === undefined) {
          context.addIssue({ code: "custom", path: [field], message: "REQUIRED_FOR_OPENAI" });
        }
      }
    }

    if (productionEquivalent && environment.OTEL_EXPORTER_OTLP_ENDPOINT === undefined) {
      context.addIssue({
        code: "custom",
        path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
        message: "REQUIRED_IN_PRODUCTION_EQUIVALENT_ENVIRONMENT",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

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
