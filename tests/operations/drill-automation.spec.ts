import { describe, expect, it } from "vitest";

import { runQuarterlyRestoreDrill } from "../../ops/drills/quarterly-restore.js";
import { runSuppressionCleanupDrill } from "../../ops/drills/suppression-cleanup.js";

describe("quarterly restore drill readiness automation", () => {
  it("validates complete local procedure without claiming real PITR", () => {
    const result = runQuarterlyRestoreDrill({
      inventoryComplete: true,
      isolatedRestore: true,
      neighboringDataVerified: true,
      networkIsolationVerified: true,
      reconciliationComplete: true,
      restoreCopyDestroyed: true,
      rpoMeasured: true,
      rtoMeasured: true,
    });
    expect(result).toEqual({
      evidenceClass: "non_production_readiness",
      realPitrExecuted: false,
      result: "pass",
      safeBlockerClasses: [],
    });
  });

  it("fails closed with content-free missing-step classes", () => {
    const result = runQuarterlyRestoreDrill({
      inventoryComplete: false,
      isolatedRestore: true,
      neighboringDataVerified: true,
      networkIsolationVerified: true,
      reconciliationComplete: false,
      restoreCopyDestroyed: true,
      rpoMeasured: true,
      rtoMeasured: true,
    });
    expect(result.result).toBe("blocked");
    expect(result.safeBlockerClasses).toEqual([
      "missing.inventory-complete",
      "missing.reconciliation-complete",
    ]);
  });
});

describe("suppression cleanup drill readiness automation", () => {
  it("passes only complete proof with zero time-only path", () => {
    expect(
      runSuppressionCleanupDrill({
        alertRetryVerified: true,
        blockerRetentionVerified: true,
        eligibleRemovalProofVerified: true,
        inventoryComplete: true,
        keyRetentionVerified: true,
        timeOnlyRemovalPaths: 0,
      }),
    ).toMatchObject({ realCleanupExecuted: false, result: "pass" });
  });

  it("blocks elapsed-time-only cleanup and missing retention proof", () => {
    expect(
      runSuppressionCleanupDrill({
        alertRetryVerified: true,
        blockerRetentionVerified: false,
        eligibleRemovalProofVerified: true,
        inventoryComplete: true,
        keyRetentionVerified: false,
        timeOnlyRemovalPaths: 1,
      }),
    ).toMatchObject({
      result: "blocked",
      safeBlockerClasses: [
        "blocker-retention.unverified",
        "key-retention.unverified",
        "time-only-removal.detected",
      ],
    });
  });
});
