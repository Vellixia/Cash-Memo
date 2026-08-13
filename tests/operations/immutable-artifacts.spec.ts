import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
const read = (path: string) => readFile(path, "utf8");

async function execute(file: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    const result = await execFileAsync("node", [file, ...args], {
      env: { PATH: process.env["PATH"], ...env },
    });
    return { code: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string; stdout?: string };
    return {
      code: failure.code ?? 1,
      stderr: failure.stderr ?? "",
      stdout: failure.stdout ?? "",
    };
  }
}

describe("immutable Cashmemo artifacts", () => {
  it("pins runtime base, UID, read-only contract, and three fixed roles", async () => {
    const dockerfile = await read("infra/containers/Dockerfile");
    const entrypoint = await read("infra/containers/runtime-entrypoint.mjs");
    const server = await read("apps/server/src/bootstrap/server.ts");
    expect(dockerfile).toMatch(/node:24\.14\.0-bookworm-slim@sha256:[0-9a-f]{64}/u);
    expect(dockerfile).toContain("USER 10001:10001");
    expect(dockerfile).toContain("CASHMEMO_IMAGE_REVISION=${RELEASE_SHA}");
    expect(dockerfile).toContain('dev.cashmemo.runtime.root-filesystem="read-only-required"');
    expect(dockerfile).toContain("pnpm --filter @cashmemo/server deploy --prod");
    expect(entrypoint).toContain("api:");
    expect(entrypoint).toContain("worker:");
    expect(entrypoint).toContain("migrate:");
    expect(entrypoint).toContain("/workspace/scripts/db/migrate-production.mjs");
    expect(entrypoint).toContain("process.env.BUILD_VERSION = imageRevision");
    expect(entrypoint).not.toMatch(/exec\(|shell:\s*true|\/bin\/sh/u);
    expect(dockerfile).toContain("/workspace/apps/web/dist");
    expect(server).toContain('process.env["NODE_ENV"] === "production"');
    expect(server).toContain('app.get("/*", servePwa)');
  });

  it("rejects unknown runtime roles without a shell or leaked input", async () => {
    const marker = "synthetic-secret-must-not-appear";
    const result = await execute("infra/containers/runtime-entrypoint.mjs", [marker]);
    expect(result.code).toBe(64);
    expect(result.stderr).toBe("CASHMEMO_RUNTIME_ROLE_INVALID\n");
    expect(result.stderr).not.toContain(marker);
  });

  it("keeps health and pgBackRest configuration failures content-free", async () => {
    const health = await execute("infra/containers/runtime-healthcheck.mjs", ["ready"], {
      PORT: "3000",
      PROCESS_ROLE: "migrate",
    });
    expect(health.code).toBe(64);
    expect(`${health.stdout}${health.stderr}`).toBe("");

    const marker = "synthetic-secret-like-endpoint-value";
    const pgbackrest = await execute("infra/pgbackrest/entrypoint.mjs", ["check"], {
      RUSTFS_SECONDARY_ENDPOINT: marker,
    });
    expect(pgbackrest.code).toBe(1);
    expect(pgbackrest.stderr).toBe("PGBACKREST_CONFIGURATION_FAILED\n");
    expect(pgbackrest.stderr).not.toContain(marker);
  });

  it("ships one-shot locked migration and fails incompatible schemas closed", async () => {
    const migration = await read("scripts/db/migrate-production.mjs");
    expect(migration).toContain("pg_advisory_lock");
    expect(migration).toContain("MIGRATION_CHECKSUM_MISMATCH");
    expect(migration).toContain("MIGRATION_SCHEMA_INCOMPATIBLE");
    expect(migration).toContain("process.exitCode = 1");
  });

  it("pins and verifies pgBackRest 2.59.0 with fixed encrypted S3 commands", async () => {
    const dockerfile = await read("infra/pgbackrest/Dockerfile");
    const entrypoint = await read("infra/pgbackrest/entrypoint.mjs");
    expect(dockerfile).toContain("PGBACKREST_VERSION=2.59.0");
    expect(dockerfile).toContain("sha256sum --check --strict");
    expect(dockerfile).toContain("USER 10002:10002");
    for (const mode of [
      "archive-push",
      "backup-diff",
      "backup-full",
      "check",
      "expire",
      "info",
      "pitr-restore",
      "restore",
      "stanza-create",
    ])
      expect(entrypoint).toContain(`"${mode}"`);
    expect(entrypoint).toContain("repo1-cipher-type=aes-256-cbc");
    expect(entrypoint).not.toMatch(/console\.log\(process\.env|JSON\.stringify\(process\.env/u);
  });

  it("makes verifier synthetic-only, bounded, fixed-mode, and content-safe", async () => {
    const script = await read("scripts/verify/development-verifier.mjs");
    expect(script).toContain("CASHMEMO_SYNTHETIC_VERIFICATION");
    expect(script).toContain("VERIFIER_ENVIRONMENT_FORBIDDEN");
    expect(script).toContain("3_600_000");
    expect(script).toContain('stdio: "ignore"');
    expect(script).toContain("shell: false");
    expect(script).toContain("CASHMEMO_EXTERNAL_TEST_DATABASE_URL");
    expect(script).toContain('CREATE DATABASE "${databaseName}"');
    expect(script).toContain('DROP DATABASE IF EXISTS "${databaseName}"');
    expect(script).not.toMatch(/console\.log\(error|JSON\.stringify\(error/u);

    const marker = "synthetic-injected-value-never-log";
    const result = await execute("scripts/verify/development-verifier.mjs", ["otel"], {
      APP_ENV: "development",
      CASHMEMO_SYNTHETIC_VERIFICATION: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: marker,
    });
    expect(result.code).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
  });

  it("defines exact non-public verifier modes", async () => {
    const script = await read("scripts/verify/development-verifier.mjs");
    const dockerfile = await read("infra/containers/Verifier.Dockerfile");
    for (const mode of [
      "postgres",
      "rustfs-primary",
      "rustfs-secondary",
      "auth",
      "stories",
      "operations",
      "otel",
      "full-development",
    ])
      expect(script).toContain(`"${mode}"`);
    expect(dockerfile).toContain("USER 10003:10003");
    expect(dockerfile).not.toContain("EXPOSE");
    expect(dockerfile).toContain('dev.cashmemo.verifier.production="forbidden"');
  });

  it("uses one runtime digest variable for API, worker, and migration", async () => {
    const composeText = await read("infra/dokploy/compose.yaml");
    const compose = YAML.parse(composeText) as { services: Record<string, { image: string }> };
    const runtimeServices = ["cashmemo-api", "cashmemo-worker", "cashmemo-migrate"];
    const identities = runtimeServices.map((name) => compose.services[name]?.image);
    expect(new Set(identities)).toEqual(new Set([identities[0]]));
    expect(identities[0]).toContain("CASHMEMO_RUNTIME_IMAGE");
  });

  it("preserves managed PostgreSQL, RustFS, Infisical, and OTLP resources", async () => {
    const compose = await read("infra/dokploy/compose.yaml");
    for (const service of [
      "postgres",
      "rustfs-primary",
      "rustfs-secondary-dev",
      "infisical",
      "otel-collector",
      "openobserve",
    ]) {
      expect(compose).not.toMatch(new RegExp(`^  ${service}:`, "mu"));
    }
    expect(compose).not.toContain("ports:");
    expect(compose).not.toMatch(/raw.?audio.?bucket/iu);
  });

  it("separates workload environment contracts and never stores values", async () => {
    const contract = JSON.parse(await read("infra/dokploy/environment-contract.json")) as Record<
      string,
      unknown
    >;
    expect(contract).toHaveProperty("api");
    expect(contract).toHaveProperty("worker");
    expect(contract).toHaveProperty("migration");
    expect(contract).toHaveProperty("pgBackRest");
    expect(contract).toHaveProperty("verifier");
    expect(JSON.stringify(contract)).not.toMatch(/postgres(?:ql)?:\/\//u);
  });

  it("publishes three digest-addressed GHCR artifacts with scans and SBOM attestations", async () => {
    const bake = await read("infra/containers/docker-bake.hcl");
    const workflow = await read(".github/workflows/deploy.yml");
    for (const target of ["runtime", "pgbackrest", "verifier"]) {
      expect(bake).toContain(`target "${target}"`);
      expect(workflow).toContain(target);
    }
    expect(bake.match(/type=sbom/gu)).toHaveLength(3);
    expect(bake.match(/push-by-digest=true/gu)).toHaveLength(3);
    expect(workflow).toContain("ghcr.io");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toContain("|| true");
  });
});
