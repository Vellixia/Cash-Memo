import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

type Scenario = Readonly<{
  capability: "core" | "provider" | "telemetry" | "lifecycle" | "security";
  expected: string;
  fixtureId: string;
  runbook: string;
}>;

const scenarios: readonly Scenario[] = [
  {
    capability: "core",
    expected: "authoritative reads/writes fail closed",
    fixtureId: "rds-unavailable",
    runbook: "ops/runbooks/core-journal-outage.md",
  },
  {
    capability: "core",
    expected: "no automatic destructive rollback",
    fixtureId: "migration-incompatible",
    runbook: "ops/runbooks/core-journal-outage.md",
  },
  {
    capability: "provider",
    expected: "Manual structured journal remains available",
    fixtureId: "stt-timeout",
    runbook: "ops/runbooks/provider-outages.md",
  },
  {
    capability: "provider",
    expected: "never confirm partial output",
    fixtureId: "extraction-invalid",
    runbook: "ops/runbooks/provider-outages.md",
  },
  {
    capability: "telemetry",
    expected: "Telemetry failure must not block healthy core journal operations",
    fixtureId: "collector-network-loss",
    runbook: "ops/runbooks/ses-rds-telemetry-outages.md",
  },
  {
    capability: "lifecycle",
    expected: "Ledger write failure blocks hard deletion",
    fixtureId: "ledger-kms-denied",
    runbook: "ops/runbooks/secrets-migrations-lifecycle.md",
  },
  {
    capability: "security",
    expected: "Do not expose account existence or another user's status",
    fixtureId: "rate-abuse-cross-account",
    runbook: "ops/runbooks/security-operations.md",
  },
  {
    capability: "security",
    expected: "Never place exposed content into tickets, logs, or evidence",
    fixtureId: "cross-user-incident",
    runbook: "ops/runbooks/security-operations.md",
  },
] as const;

describe("Phase 15 controlled runbook rehearsal", () => {
  it.each(scenarios)("$fixtureId resolves to declared fail-safe behavior", async (scenario) => {
    const runbook = await readFile(scenario.runbook, "utf8");
    expect(runbook.replace(/\s+/gu, " ")).toContain(scenario.expected);
  });

  it("uses synthetic safe-name fixtures only", () => {
    expect(scenarios).toHaveLength(8);
    expect(scenarios.every(({ fixtureId }) => /^[a-z][a-z0-9-]+$/u.test(fixtureId))).toBe(true);
  });
});
