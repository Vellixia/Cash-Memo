interface QuarterlyRestoreDrillInput {
  readonly inventoryComplete: boolean;
  readonly isolatedRestore: boolean;
  readonly neighboringDataVerified: boolean;
  readonly networkIsolationVerified: boolean;
  readonly reconciliationComplete: boolean;
  readonly restoreCopyDestroyed: boolean;
  readonly rpoMeasured: boolean;
  readonly rtoMeasured: boolean;
}

interface DrillResult {
  readonly evidenceClass: "non_production_readiness";
  readonly realPitrExecuted: false;
  readonly result: "blocked" | "pass";
  readonly safeBlockerClasses: readonly string[];
}

function runQuarterlyRestoreDrill(input: Readonly<QuarterlyRestoreDrillInput>): DrillResult {
  const blockers = Object.entries(input)
    .filter(([, complete]) => !complete)
    .map(([name]) => `missing.${name.replaceAll(/[A-Z]/gu, (value) => `-${value.toLowerCase()}`)}`)
    .sort();
  return Object.freeze({
    evidenceClass: "non_production_readiness",
    realPitrExecuted: false,
    result: blockers.length === 0 ? "pass" : "blocked",
    safeBlockerClasses: Object.freeze(blockers),
  });
}

export { runQuarterlyRestoreDrill, type DrillResult, type QuarterlyRestoreDrillInput };
