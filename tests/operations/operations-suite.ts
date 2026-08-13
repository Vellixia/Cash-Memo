import { spawnSync } from "node:child_process";

const files = [
  "tests/providers/aws-deletion-ledger.contract.spec.ts",
  "tests/providers/aws-backup-inventory.contract.spec.ts",
  "apps/server/tests/integration/write-before-purge.spec.ts",
  "apps/server/tests/privacy/deletion-restore-readiness-privacy.spec.ts",
  "tests/operations/suppression-cleanup.spec.ts",
  "tests/operations/no-resurrection-policy.spec.ts",
  "tests/operations/restore-reconciliation.spec.ts",
  "tests/operations/restore-commands.spec.ts",
  "tests/operations/drill-automation.spec.ts",
];

const tests = spawnSync("corepack", ["pnpm", "exec", "vitest", "run", ...files], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: "inherit",
});
if (tests.status !== 0) {
  console.error("OPERATIONS_SUITE=BLOCKED class=contract-or-integration-failure");
  process.exit(tests.status ?? 1);
}

const supportBuild = spawnSync(
  "corepack",
  ["pnpm", "--filter", "@cashmemo/test-support", "build"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (supportBuild.status !== 0) {
  console.error("OPERATIONS_SUITE=BLOCKED class=evidence-dependency-build-failure");
  process.exit(supportBuild.status ?? 1);
}

const evidence = spawnSync(
  "corepack",
  ["pnpm", "exec", "tsx", "scripts/operations/write-deletion-restore-readiness.ts"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (evidence.status !== 0) {
  console.error("OPERATIONS_SUITE=BLOCKED class=evidence-failure");
  process.exit(evidence.status ?? 1);
}

console.log("OPERATIONS_SUITE=PASS mode=local-contract sc021=OPEN real-pitr=OPEN");
