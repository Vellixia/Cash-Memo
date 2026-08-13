import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const read = (path: string) => readFile(path, "utf8");

describe("Phase 15 production infrastructure", () => {
  it("pins reviewed OpenTofu and AWS provider versions with encrypted locked remote state", async () => {
    expect(await read(".tool-versions")).toContain("opentofu 1.12.5");
    const versions = await read("infra/opentofu/versions.tf");
    const backend = await read("infra/opentofu/backend.tf");
    expect(versions).toContain('required_version = "= 1.12.5"');
    expect(versions).toContain('version = "= 6.59.0"');
    expect(backend).toContain("encrypt      = true");
    expect(backend).toContain("use_lockfile = true");
    expect(backend).toContain("reviewed_plan_sha256 == var.approved_plan_sha256");
  });

  it("keeps ALB public while application and database tiers remain private", async () => {
    const source = await read("infra/opentofu/modules/network/main.tf");
    expect(source).toContain('description = "Public HTTPS boundary only"');
    expect(source).toContain('cidr_ipv4         = "0.0.0.0/0"');
    expect(source).toContain("referenced_security_group_id = aws_security_group.application.id");
    expect(source).toContain("referenced_security_group_id = aws_security_group.database.id");
    const databaseIngress = source.slice(
      source.indexOf('resource "aws_vpc_security_group_ingress_rule" "database_from_application"'),
      source.indexOf('resource "aws_lb"'),
    );
    expect(databaseIngress).not.toContain("cidr_ipv4");
  });

  it("uses one immutable release image for API, worker, and migration roles", async () => {
    const compute = await read("infra/opentofu/modules/compute/main.tf");
    const migration = await read("infra/opentofu/modules/compute/migration-task.tf");
    expect(compute).toContain(
      'release_image = "${aws_ecr_repository.this.repository_url}@${var.image_digest}"',
    );
    expect(compute.match(/image\s*=\s*local\.release_image/gmu)).toHaveLength(2);
    expect(migration).toMatch(/image\s*=\s*local\.release_image/u);
    expect(compute).toContain("deployment_circuit_breaker");
    expect(compute).toContain('drop = ["ALL"]');
    expect(compute).toContain("readonlyRootFilesystem = true");
  });

  it("models PostgreSQL 18 Multi-AZ private encrypted RDS with bounded backups", async () => {
    const source = await read("infra/opentofu/modules/database/main.tf");
    const requiredAttributes: readonly (readonly [string, string])[] = [
      ["engine_version", '"18.0"'],
      ["multi_az", "true"],
      ["publicly_accessible", "false"],
      ["storage_encrypted", "true"],
      ["backup_retention_period", "35"],
      ["deletion_protection", "true"],
      ["manage_master_user_password", "true"],
    ];
    for (const [name, value] of requiredAttributes)
      expect(source).toMatch(new RegExp(`${name}\\s*=\\s*${value}`));
  });

  it("creates only three private KMS storage classes and no lifecycle for deletion ledger", async () => {
    const source = await read("infra/opentofu/modules/storage/main.tf");
    expect(source).toContain('toset(["exports", "evidence", "deletion-ledger"])');
    expect(source).toContain("block_public_policy     = true");
    expect(source).toContain('resource "aws_s3_bucket_lifecycle_configuration" "exports"');
    expect(source).not.toMatch(/lifecycle_configuration" "deletion/u);
    expect(source).not.toMatch(/audio.*bucket|bucket.*audio/iu);
  });

  it("defines SES identity, DKIM, suppression, and content-free status routing", async () => {
    const source = await read("infra/opentofu/modules/email/main.tf");
    expect(source).toContain('resource "aws_ses_domain_identity"');
    expect(source).toContain('resource "aws_ses_domain_dkim"');
    expect(source).toContain('suppressed_reasons = ["BOUNCE", "COMPLAINT"]');
    expect(source).toMatch(/event_destination_name\s*=\s*"content-free-delivery-status"/u);
  });

  it("separates runtime, worker, migration, restore, deployment, and break-glass roles", async () => {
    const source = await read("infra/opentofu/modules/security/main.tf");
    for (const role of ["runtime", "worker", "migration", "restore", "deployment", "break_glass"])
      expect(source).toContain(role);
    expect(source).toContain("runtime_has_no_privileged_database_secret");
    const runtimePolicy = source.slice(
      source.indexOf('resource "aws_iam_role_policy" "runtime"'),
      source.indexOf('resource "aws_iam_role_policy" "worker"'),
    );
    expect(runtimePolicy).not.toContain('["migration"]');
    expect(runtimePolicy).not.toContain('["restore"]');
  });

  it("separates core and provider observability and includes lifecycle alarms", async () => {
    const source = await read("infra/opentofu/modules/observability/main.tf");
    expect(source).toContain('dashboard_name = "${var.name}-core"');
    expect(source).toContain('dashboard_name = "${var.name}-providers"');
    for (const alarm of [
      "worker_backlog",
      "audio_cleanup",
      "deletion_backlog",
      "export_backlog",
      "backup_inventory",
    ])
      expect(source).toContain(alarm);
    for (const prohibited of [
      "request.body",
      "response.body",
      "transcript",
      "memo content",
      "search query",
    ])
      expect(source.toLowerCase()).not.toContain(prohibited);
  });

  it("fails data-safety health closed and monitors resurrection-capable copy events", async () => {
    const source = await read("infra/opentofu/modules/data-safety/main.tf");
    for (const alarm of [
      "pitr_health",
      "copy_policy_drift",
      "inventory_unavailable",
      "inventory_stale",
      "restore_drill_missed",
      "rpo_risk",
      "rto_risk",
      "suppression_cleanup_blocked",
    ])
      expect(source).toContain(alarm);
    expect(source).toMatch(/treat_missing_data\s*=\s*"breaching"/u);
    expect(source).toContain("StartRestoreJob");
  });

  it("protects production migrations with one advisory lock and schema/checksum verification", async () => {
    const source = await read("scripts/db/migrate-production.mjs");
    expect(source).toContain("pg_advisory_lock");
    expect(source).toContain("MIGRATION_CHECKSUM_MISMATCH");
    expect(source).toContain("MIGRATION_SCHEMA_INCOMPATIBLE");
    expect(source).toContain("MIGRATION_BUILD_ID_INVALID");
    expect(source).not.toContain("console.error(error");
  });

  it("hardens OCI runtime and emits SBOM/provenance by immutable digest", async () => {
    const dockerfile = await read("infra/containers/Dockerfile");
    const bake = await read("infra/containers/docker-bake.hcl");
    expect(dockerfile).toMatch(/ARG NODE_IMAGE=.*@sha256:[0-9a-f]{64}/u);
    expect(dockerfile).toContain("FROM ${NODE_IMAGE} AS production");
    expect(dockerfile).toContain("USER 10001:10001");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).not.toContain(":latest");
    expect(bake).toContain("type=sbom");
    expect(bake).toContain("type=provenance,mode=max");
    expect(bake).toContain("push-by-digest=true");
  });

  it("makes deployment gates blocking and applies only protected reviewed plan", async () => {
    const workflow = await read(".github/workflows/deploy.yml");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("APPROVED_PLAN_SHA256");
    expect(workflow).toContain("apply -input=false release.tfplan");
    expect(workflow).toContain("MIGRATION_TASK_DEFINITION");
    expect(workflow).toContain("services-stable");
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

  it("keeps staging evidence absent until real bootstrap and external blockers explicit", async () => {
    const staging = await read("infra/opentofu/environments/staging/main.tf");
    const awsBlocker: unknown = JSON.parse(
      await read("ops/evidence/external/aws-environment.json"),
    ) as unknown;
    expect(staging).toMatch(/name\s*=\s*"cashmemo-staging"/u);
    await expect(read("ops/evidence/infrastructure/staging-bootstrap.json")).rejects.toThrow();
    expect(awsBlocker).toMatchObject({ approved: false, status: "BLOCKED_EXTERNAL" });
  });

  it("provides strict provider decision schema without pretending approval", async () => {
    const schema = await read("config/providers/provider-decision.schema.json");
    expect(() => JSON.parse(schema) as unknown).not.toThrow();
    expect(schema).toContain('"additionalProperties": false');
    expect(schema).toContain('"approvalStatus"');
    expect(schema).toContain('"blocked"');
    expect(schema).toContain('"trainingUse"');
    expect(schema).toContain('"evidenceExpiresAt"');
  });

  it("runbooks preserve fail-closed core and manual provider degradation semantics", async () => {
    const core = await read("ops/runbooks/core-journal-outage.md");
    const providers = await read("ops/runbooks/provider-outages.md");
    const lifecycle = await read("ops/runbooks/secrets-migrations-lifecycle.md");
    const security = await read("ops/runbooks/security-operations.md");
    expect(core).toContain("authoritative reads/writes fail closed");
    expect(providers).toContain("Manual structured journal remains available");
    expect(lifecycle).toContain("time alone never authorizes cleanup");
    expect(security).toContain("Do not use break-glass for normal operations");
  });
});
