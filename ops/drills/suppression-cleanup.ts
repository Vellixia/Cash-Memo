interface SuppressionCleanupDrillInput {
  readonly alertRetryVerified: boolean;
  readonly blockerRetentionVerified: boolean;
  readonly eligibleRemovalProofVerified: boolean;
  readonly inventoryComplete: boolean;
  readonly keyRetentionVerified: boolean;
  readonly timeOnlyRemovalPaths: number;
}

interface CleanupDrillResult {
  readonly evidenceClass: "non_production_readiness";
  readonly realCleanupExecuted: false;
  readonly result: "blocked" | "pass";
  readonly safeBlockerClasses: readonly string[];
}

function runSuppressionCleanupDrill(
  input: Readonly<SuppressionCleanupDrillInput>,
): CleanupDrillResult {
  const blockers: string[] = [];
  if (!input.inventoryComplete) blockers.push("inventory.incomplete");
  if (!input.blockerRetentionVerified) blockers.push("blocker-retention.unverified");
  if (!input.alertRetryVerified) blockers.push("alert-retry.unverified");
  if (!input.keyRetentionVerified) blockers.push("key-retention.unverified");
  if (!input.eligibleRemovalProofVerified) blockers.push("eligible-removal.unverified");
  if (input.timeOnlyRemovalPaths !== 0) blockers.push("time-only-removal.detected");
  return Object.freeze({
    evidenceClass: "non_production_readiness",
    realCleanupExecuted: false,
    result: blockers.length === 0 ? "pass" : "blocked",
    safeBlockerClasses: Object.freeze(blockers.sort()),
  });
}

export { runSuppressionCleanupDrill, type CleanupDrillResult, type SuppressionCleanupDrillInput };
