import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const read = (path: string) => readFile(path, "utf8");

describe("Phase 15 self-hosted deployment foundation", () => {
  it("pins reviewed RustFS and pgBackRest versions without floating latest", async () => {
    const versions = JSON.parse(await read("infra/dokploy/service-versions.json")) as {
      pgBackRest: { version: string };
      rustfs: { developmentImage: string; preRelease: boolean; productionApproved: boolean };
    };
    expect(versions.rustfs).toMatchObject({
      developmentImage: "rustfs/rustfs:1.0.0-rc.1",
      preRelease: true,
      productionApproved: false,
    });
    expect(versions.pgBackRest.version).toBe("2.59.0");
    expect(await read("infra/dokploy/compose.yaml")).not.toMatch(/:latest\b/u);
  });

  it("uses one immutable release digest for API and worker roles", async () => {
    const compose = await read("infra/dokploy/compose.yaml");
    expect(compose.match(/image: \$\{CASHMEMO_IMAGE_DIGEST:/gu)).toHaveLength(2);
    expect(compose).toContain("PROCESS_ROLE: api");
    expect(compose).toContain("PROCESS_ROLE: worker");
    expect(compose).toContain('user: "10001:10001"');
    expect(compose).toContain("read_only: true");
    expect(compose).toContain('cap_drop: ["ALL"]');
  });

  it("keeps storage private, distinct, console-disabled, and raw-audio-free", async () => {
    const compose = await read("infra/dokploy/compose.yaml");
    const policy = await read("infra/dokploy/storage-policy.json");
    expect(compose).toContain("rustfs-primary-data:/data");
    expect(compose).toContain("rustfs-secondary-dev-data:/data");
    expect(compose.match(/RUSTFS_CONSOLE_ENABLE: "false"/gu)).toHaveLength(2);
    expect(compose).not.toMatch(/ports:|RUSTFS_CORS|RUSTFS_SERVER_DOMAINS/u);
    expect(policy).toContain('"rawAudioAllowed": false');
    expect(policy).toContain('"deletionLedgerLifecycleTtlAllowed": false');
    expect(policy).toContain('"developmentIndependentFailureDomain": false');
  });

  it("preserves existing PostgreSQL and forbids duplicate shared services", async () => {
    const compose = await read("infra/dokploy/compose.yaml");
    const preservation = await read("infra/dokploy/postgres-preservation.md");
    expect(compose).not.toMatch(/^\s{2}(postgres|infisical|otel-collector|openobserve):/mu);
    expect(preservation).toContain("cashmemo-test-postgres");
    expect(preservation).toContain("Replacement, recreation, volume rename, or teardown is");
    expect(preservation).toContain("Resource limits remain open");
  });

  it("pins pgBackRest source checksum and encrypted S3-compatible repository settings", async () => {
    const dockerfile = await read("infra/pgbackrest/Dockerfile");
    const config = await read("infra/pgbackrest/pgbackrest.conf.template");
    const jobs = await read("infra/dokploy/pgbackrest-jobs.json");
    expect(dockerfile).toContain("PGBACKREST_VERSION=2.59.0");
    expect(dockerfile).toContain(
      "faaf8faa14a6392279654ee216a493fcd07b0c513af4b55fe34faec062cb8875",
    );
    expect(config).toContain("repo1-type=s3");
    expect(config).toContain("repo1-s3-uri-style=path");
    expect(config).toContain("repo1-cipher-type=aes-256-cbc");
    expect(config).toContain("archive-async=y");
    expect(jobs).toContain('"repository-check"');
    expect(jobs).toContain('"differential-backup"');
    expect(jobs).toContain('"full-backup"');
    expect(jobs).toContain('"repository-expire"');
    expect(jobs).toContain("archive-push %p");
    expect(jobs).toContain('"proofRequired": true');
  });

  it("declares complete self-hosted backup lineage and fails inventory closed", async () => {
    const copyPolicy = await read("infra/dokploy/policies/backup-copy-policy.json");
    const alertPolicy = await read("infra/dokploy/backup-alert-policy.json");
    for (const value of [
      "pgbackrest_full_backup",
      "wal_archive",
      "local_repository",
      "secondary_object_version",
      "manual_operator_copy",
      "volume_snapshot",
      "replica",
      "temporary_restore_copy",
    ]) {
      expect(copyPolicy).toContain(value);
    }
    expect(copyPolicy).toContain("retain_suppression_alert_retry");
    expect(alertPolicy).toContain("inventory_unavailable_or_unverifiable");
  });

  it("uses injected Infisical secrets and shared OTLP without provider SDK coupling", async () => {
    const secrets = await read("infra/dokploy/secrets-policy.md");
    const telemetry = await read("infra/dokploy/observability.md");
    const packageSource = await read("apps/server/package.json");
    const serverSource = await read("apps/server/src/bootstrap/server.ts");
    const otlpSource = await read("apps/server/src/adapters/telemetry/otlp-http.sink.ts");
    expect(secrets).toContain("does not import an Infisical SDK");
    expect(telemetry).toContain("existing shared");
    expect(telemetry).toContain("allowlisted");
    expect(packageSource).not.toMatch(/infisical|openobserve/iu);
    expect(serverSource).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
    expect(otlpSource).toContain("cashmemo.safe-telemetry");
    expect(otlpSource).not.toMatch(/request\.body|response\.body|accountId|memoContent|email/iu);
  });

  it("publishes an immutable handoff and contains no deployment mutation", async () => {
    const workflow = await read(".github/workflows/deploy.yml");
    const bake = await read("infra/containers/docker-bake.hcl");
    expect(workflow).not.toContain("continue-on-error");
    expect(bake).toContain("push-by-digest=true");
    expect(workflow).toContain("cashmemo-dokploy-handoff-v1");
    expect(workflow).toContain("deployed:false");
    expect(workflow).not.toMatch(
      /curl.*dokploy|dokploy\s+(?:deploy|compose)|opentofu|terraform|aws /iu,
    );
  });

  it("hardens OCI runtime and dispatches API/worker from one image", async () => {
    const dockerfile = await read("infra/containers/Dockerfile");
    const bake = await read("infra/containers/docker-bake.hcl");
    expect(dockerfile).toMatch(/ARG NODE_IMAGE=.*@sha256:[0-9a-f]{64}/u);
    expect(dockerfile).toContain("USER 10001:10001");
    expect(dockerfile).toContain("bootstrap/main.js");
    expect(dockerfile).not.toContain(":latest");
    expect(bake).toContain("type=sbom");
    expect(bake).toContain("type=provenance,mode=max");
  });

  it.each([
    [
      {
        currentSchema: 5,
        previousImageSchemaMin: 4,
        previousImageSchemaMax: 5,
        forwardFixAvailable: false,
        incidentId: "INC_ROLLBACK",
      },
      "ROLLBACK_SAFE",
      0,
    ],
    [
      {
        currentSchema: 6,
        previousImageSchemaMin: 4,
        previousImageSchemaMax: 5,
        forwardFixAvailable: true,
        incidentId: "INC_FORWARD",
      },
      "SAFE_FORWARD_REQUIRED",
      0,
    ],
    [
      {
        currentSchema: 6,
        previousImageSchemaMin: 4,
        previousImageSchemaMax: 5,
        forwardFixAvailable: false,
        incidentId: "INC_BLOCKED",
      },
      "BLOCKED_MANUAL_ESCALATION",
      2,
    ],
  ])("returns deterministic rollback decision %#", async (manifest, expected, code) => {
    const directory = await mkdtemp(join(tmpdir(), "cashmemo-deploy-"));
    const file = join(directory, "manifest.json");
    await writeFile(file, JSON.stringify(manifest));
    try {
      const result = await execFileAsync("node", [
        "scripts/deploy/rollback-or-safe-forward.mjs",
        file,
      ]).catch((error: unknown) => {
        const failure = error as { stdout?: unknown; code?: unknown };
        return {
          stdout: typeof failure.stdout === "string" ? failure.stdout : "",
          code: typeof failure.code === "number" ? failure.code : 1,
        };
      });
      expect(result.stdout).toContain(expected);
      expect("code" in result ? result.code : 0).toBe(code);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps Dokploy bootstrap and production bindings explicitly absent/blocked", async () => {
    await expect(
      read("ops/evidence/infrastructure/dokploy-development-bootstrap.json"),
    ).rejects.toThrow();
    const inputs = await read("infra/dokploy/production-inputs.example");
    expect(inputs).toContain("REQUIRED_INDEPENDENT_FAILURE_DOMAIN");
    expect(inputs).toContain("sha256:REQUIRED");
  });
});
