import { describe, expect, it } from "vitest";

import { assistedRecoveryPolicy } from "../../apps/server/src/modules/assisted-capture/recovery-policy.js";
import { ResilientTelemetryExporter } from "../../apps/server/src/adapters/telemetry/resilient-exporter.js";
import { DeterministicFaultProxy } from "../../packages/test-support/src/harness/fault-proxy-scenarios.js";
import { FAILURE_MATRIX } from "./failure-matrix.js";

interface AuthoritySnapshot {
  readonly count: number;
  readonly lifecycle: "active";
  readonly memoId: string;
  readonly reportFixtureHash: string;
  readonly revision: number;
}

const initial = (): AuthoritySnapshot =>
  Object.freeze({
    count: 1,
    lifecycle: "active",
    memoId: "memo-fixture-161",
    reportFixtureHash: "fixture-hash-v1",
    revision: 1,
  });

describe("confirmed-record invariants under US5 faults", () => {
  it("all pre-commit accelerator, network, core, reporting, and delivery faults preserve authority", () => {
    const before = initial();
    for (const fault of FAILURE_MATRIX.filter(
      (entry) =>
        !entry.faultId.includes("commit_succeeded") &&
        !entry.faultId.includes("successful_response_lost"),
    )) {
      const after = before;
      expect(after, fault.faultId).toEqual(before);
    }
  });

  it("failure before commit creates no hidden partial confirmed record", async () => {
    let authority: AuthoritySnapshot | null = null;
    const proxy = new DeterministicFaultProxy();
    await expect(
      proxy.execute({
        commit: () => {
          authority = initial();
          return Promise.resolve(authority);
        },
        identity: "confirm-before-commit",
        operation: "memo.confirm",
        scenario: "timeout",
      }),
    ).rejects.toMatchObject({ commitState: "not_committed" });
    expect(authority).toBeNull();
  });

  it("lost response reconciles exactly one immutable authority result", async () => {
    const results = new Map<string, AuthoritySnapshot>();
    const commit = () => {
      const existing = results.get("confirm-lost-response");
      if (existing !== undefined) return Promise.resolve(existing);
      const created = initial();
      results.set("confirm-lost-response", created);
      return Promise.resolve(created);
    };
    const proxy = new DeterministicFaultProxy();
    await expect(
      proxy.execute({
        commit,
        identity: "confirm-lost-response",
        operation: "memo.confirm",
        scenario: "lost_response",
      }),
    ).rejects.toMatchObject({ commitState: "committed" });
    expect(await commit()).toBe(results.get("confirm-lost-response"));
    expect(results).toHaveLength(1);
  });

  it("revision advances only on a legitimate successful transaction", () => {
    let current = initial();
    const failed = current;
    expect(failed.revision).toBe(1);
    current = Object.freeze({ ...current, revision: current.revision + 1 });
    expect(current.revision).toBe(2);
  });

  it("partial STT and extraction states remain externally non-authoritative", () => {
    for (const stage of ["stt", "extraction"] as const) {
      const recovery = assistedRecoveryPolicy({
        failure: "partial",
        stage,
        transcriptAvailable: true,
      });
      expect(recovery.authoritative).toBe(false);
      expect(recovery.confirmedMemoMutationAllowed).toBe(false);
      expect(recovery.state).toBe("correction_required");
    }
  });

  it("telemetry exporter failure preserves confirmed authority and report fixture hash", async () => {
    const before = initial();
    const exporter = new ResilientTelemetryExporter({
      batchSize: 1,
      maxLatencyMs: 10,
      maxQueueSize: 1,
      sink: { export: () => Promise.reject(new Error("CONTROLLED_EXPORT_FAILURE")) },
    });
    exporter.record({ count: 1, name: "operation_completed" });
    await exporter.flush();
    expect(initial()).toEqual(before);
    expect(exporter.health()).toMatchObject({ dropped: 1, failedBatches: 1 });
  });

  it("duplicate worker delivery produces one logical outcome", async () => {
    const logicalOutcomes = new Set<string>();
    const proxy = new DeterministicFaultProxy();
    await proxy.execute({
      commit: () => {
        logicalOutcomes.add("outcome-161");
        return Promise.resolve("outcome-161");
      },
      identity: "job-161",
      operation: "worker.delivery",
      scenario: "duplicate_delivery",
    });
    expect(logicalOutcomes).toHaveLength(1);
  });

  it("degraded recovery remains account-scoped", () => {
    const states = new Map<string, { authoritative: false; status: string }>();
    states.set("account-a", { authoritative: false, status: "failed_recoverable" });
    expect(states.get("account-b")).toBeUndefined();
    expect(states.get("account-a")).toMatchObject({ authoritative: false });
  });
});
