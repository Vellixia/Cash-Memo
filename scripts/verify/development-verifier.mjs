import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { Client as MinioClient } from "minio";
import pg from "pg";

const { Client: PostgresClient } = pg;
const modes = new Set([
  "postgres",
  "rustfs-primary",
  "rustfs-secondary",
  "auth",
  "stories",
  "operations",
  "otel",
  "full-development",
]);
const timeoutMs = Math.min(
  Math.max(Number.parseInt(process.env.CASHMEMO_VERIFIER_TIMEOUT_MS ?? "1200000", 10), 10_000),
  3_600_000,
);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`MISSING_SAFE_CONFIG_NAME:${name}`);
  return value;
}

function requireDevelopmentSafety() {
  if (process.env.CASHMEMO_SYNTHETIC_VERIFICATION !== "1") {
    throw new Error("SYNTHETIC_VERIFICATION_REQUIRED");
  }
  if (!new Set(["development", "staging", "test"]).has(process.env.APP_ENV)) {
    throw new Error("VERIFIER_ENVIRONMENT_FORBIDDEN");
  }
}

async function retry(label, operation) {
  const deadline = Date.now() + Math.min(timeoutMs, 120_000);
  while (Date.now() < deadline) {
    try {
      await operation();
      process.stdout.write(`VERIFIER_DEPENDENCY=${label} status=ready\n`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`DEPENDENCY_UNAVAILABLE:${label}`);
}

async function waitForPostgres() {
  const connectionString = required("CASHMEMO_EXTERNAL_TEST_DATABASE_URL");
  await retry("postgres", async () => {
    const client = new PostgresClient({ connectionString });
    try {
      await client.connect();
      await client.query("SELECT 1");
    } finally {
      await client.end().catch(() => undefined);
    }
  });
}

async function withIsolatedAcceptanceDatabase(operation) {
  const controlUrl = new URL(required("CASHMEMO_EXTERNAL_TEST_DATABASE_URL"));
  const databaseName = `cashmemo_verify_${randomUUID().replaceAll("-", "")}`;
  const control = new PostgresClient({ connectionString: controlUrl.toString() });
  await control.connect();
  await control.query(`CREATE DATABASE "${databaseName}"`);
  await control.end();

  const databaseUrl = new URL(controlUrl);
  databaseUrl.pathname = `/${databaseName}`;
  try {
    await runFixed("acceptance-migration", "node", ["scripts/db/migrate-production.mjs"], {
      BUILD_VERSION: required("CASHMEMO_IMAGE_REVISION"),
      DATABASE_URL: databaseUrl.toString(),
    });
    await operation(databaseUrl.toString());
  } finally {
    const cleanup = new PostgresClient({ connectionString: controlUrl.toString() });
    await cleanup.connect();
    try {
      await cleanup.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [databaseName],
      );
      await cleanup.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally {
      await cleanup.end();
    }
  }
}

function parseS3(prefix) {
  const endpoint = new URL(required(`${prefix}_ENDPOINT`));
  return {
    client: new MinioClient({
      accessKey: required(`${prefix}_ACCESS_KEY`),
      endPoint: endpoint.hostname,
      pathStyle: true,
      port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === "https:" ? 443 : 80,
      secretKey: required(`${prefix}_SECRET_KEY`),
      useSSL: endpoint.protocol === "https:",
    }),
    region: required(`${prefix}_REGION`),
  };
}

async function ensurePrivateVersionedBuckets(prefix, names) {
  const { client, region } = parseS3(prefix);
  await retry(prefix.toLowerCase(), async () => {
    for (const name of names) {
      const bucket = required(name);
      if (!(await client.bucketExists(bucket))) await client.makeBucket(bucket, region);
      await client.setBucketVersioning(bucket, { Status: "Enabled" });
    }
  });
}

async function runFixed(label, command, args, extraEnvironment = {}) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnvironment },
      shell: false,
      stdio: "ignore",
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal === null ? (code ?? 1) : 1));
  });
  if (exitCode !== 0) throw new Error(`SUITE_FAILED:${label}`);
  process.stdout.write(`VERIFIER_SUITE=${label} status=pass\n`);
}

async function verifyOtlp() {
  const endpoint = new URL(required("OTEL_EXPORTER_OTLP_ENDPOINT"));
  if (!endpoint.pathname.endsWith("/v1/metrics")) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, "")}/v1/metrics`;
  }
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "cashmemo-verifier" } }],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "cashmemo.verifier_connectivity",
                  sum: {
                    aggregationTemporality: 1,
                    dataPoints: [
                      { asInt: "1", timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString() },
                    ],
                    isMonotonic: false,
                  },
                },
              ],
              scope: { name: "cashmemo.safe-telemetry" },
            },
          ],
        },
      ],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("OTLP_UNAVAILABLE");
  process.stdout.write("VERIFIER_SUITE=otel status=pass\n");
}

async function execute(mode) {
  requireDevelopmentSafety();
  process.env.CASHMEMO_ALLOW_EXTERNAL_TEST_DATABASE = "1";
  if (!modes.has(mode)) throw new Error("VERIFIER_MODE_INVALID");

  const selected =
    mode === "full-development"
      ? ["postgres", "rustfs-primary", "rustfs-secondary", "auth", "operations", "otel", "stories"]
      : [mode];
  for (const item of selected) {
    if (item === "postgres") {
      await waitForPostgres();
      await runFixed("postgres-integration", "corepack", ["pnpm", "test:integration"]);
      await runFixed("postgres-contract", "corepack", ["pnpm", "test:contract"]);
      await runFixed("postgres-privacy", "corepack", ["pnpm", "test:privacy"]);
      await runFixed("postgres-security", "corepack", ["pnpm", "test:security"]);
    } else if (item === "rustfs-primary") {
      await ensurePrivateVersionedBuckets("RUSTFS_PRIMARY", [
        "RUSTFS_EXPORT_BUCKET",
        "RUSTFS_EVIDENCE_BUCKET",
      ]);
      await runFixed("rustfs-primary", "corepack", ["pnpm", "test:rustfs:real"], {
        CASHMEMO_RUSTFS_REAL_INTEGRATION: "1",
        CASHMEMO_VERIFY_RUSTFS_SCOPE: "primary",
      });
    } else if (item === "rustfs-secondary") {
      await ensurePrivateVersionedBuckets("RUSTFS_SECONDARY", [
        "PGBACKREST_REPOSITORY_BUCKET",
        "RUSTFS_SECONDARY_BUCKET",
      ]);
      await runFixed("rustfs-secondary", "corepack", ["pnpm", "test:rustfs:real"], {
        CASHMEMO_RUSTFS_REAL_INTEGRATION: "1",
        CASHMEMO_VERIFY_RUSTFS_SCOPE: "secondary",
      });
    } else if (item === "auth") {
      await waitForPostgres();
      await runFixed("auth", "corepack", ["pnpm", "test:auth:better-auth-compat"]);
    } else if (item === "stories") {
      await waitForPostgres();
      await withIsolatedAcceptanceDatabase(async (databaseUrl) => {
        await runFixed("stories", "corepack", ["pnpm", "test:acceptance"], {
          APP_ENV: "test",
          APP_ORIGIN: "http://localhost:5173",
          AUTH_DATABASE_URL: databaseUrl,
          BUILD_VERSION: required("CASHMEMO_IMAGE_REVISION"),
          DATABASE_URL: databaseUrl,
          PORT: "3000",
          PROCESS_ROLE: "api",
        });
      });
    } else if (item === "operations") {
      await waitForPostgres();
      await runFixed("operations", "corepack", ["pnpm", "test:operations"]);
    } else if (item === "otel") {
      await verifyOtlp();
    }
  }
}

const mode = process.argv[2] ?? "full-development";
const watchdog = setTimeout(() => {
  process.stderr.write("VERIFIER_RESULT=FAIL code=VERIFIER_TIMEOUT\n");
  process.exit(124);
}, timeoutMs);
execute(mode)
  .then(() => process.stdout.write(`VERIFIER_RESULT=PASS mode=${mode}\n`))
  .catch((error) => {
    const code =
      error instanceof Error && /^[A-Z_]+(?::[a-z0-9-]+)?$/u.test(error.message)
        ? error.message
        : "VERIFIER_FAILED";
    process.stderr.write(`VERIFIER_RESULT=FAIL code=${code}\n`);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
