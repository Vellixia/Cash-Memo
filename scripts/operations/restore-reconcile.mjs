import { pathToFileURL } from "node:url";

const SAFE_BLOCKERS = new Set([
  "incomplete_reconciliation",
  "ledger_unavailable",
  "missing_key",
  "verification_failed",
]);

function executeRestoreReconcile(input) {
  if (input.networkIsolated !== true) {
    return Object.freeze({
      checklist: "blocked",
      result: "BLOCKED",
      safeBlockerClass: "network_not_isolated",
    });
  }
  if (input.ledgerAvailable !== true) {
    return Object.freeze({
      checklist: "blocked",
      result: "BLOCKED",
      safeBlockerClass: "ledger_unavailable",
    });
  }
  if (input.allRequiredKeysAvailable !== true) {
    return Object.freeze({
      checklist: "blocked",
      result: "BLOCKED",
      safeBlockerClass: "missing_key",
    });
  }
  if (input.accountFirstComplete !== true || input.memoMatchingComplete !== true) {
    return Object.freeze({
      checklist: "blocked",
      result: "BLOCKED",
      safeBlockerClass: "incomplete_reconciliation",
    });
  }
  if (
    input.sweepersComplete !== true ||
    input.sessionsRevoked !== true ||
    input.verificationComplete !== true
  ) {
    return Object.freeze({
      checklist: "blocked",
      result: "BLOCKED",
      safeBlockerClass: "verification_failed",
    });
  }
  return Object.freeze({ checklist: "complete", result: "PASS", safeBlockerClass: null });
}

function syntheticInput(mode) {
  const pass = {
    accountFirstComplete: true,
    allRequiredKeysAvailable: true,
    ledgerAvailable: true,
    memoMatchingComplete: true,
    networkIsolated: true,
    sessionsRevoked: true,
    sweepersComplete: true,
    verificationComplete: true,
  };
  if (mode === "pass") return pass;
  if (!SAFE_BLOCKERS.has(mode)) return { ...pass, networkIsolated: false };
  if (mode === "ledger_unavailable") return { ...pass, ledgerAvailable: false };
  if (mode === "missing_key") return { ...pass, allRequiredKeysAvailable: false };
  if (mode === "incomplete_reconciliation") return { ...pass, memoMatchingComplete: false };
  return { ...pass, verificationComplete: false };
}

async function main() {
  const modeArgument = process.argv.find((argument) => argument.startsWith("--synthetic="));
  if (modeArgument === undefined) {
    process.stderr.write("RESTORE_RECONCILIATION=BLOCKED blocker=explicit-mode-required\n");
    process.exitCode = 2;
    return;
  }
  const result = executeRestoreReconcile(syntheticInput(modeArgument.slice("--synthetic=".length)));
  process.stdout.write(
    `RESTORE_RECONCILIATION=${result.result} checklist=${result.checklist}${result.safeBlockerClass === null ? "" : ` blocker=${result.safeBlockerClass}`}\n`,
  );
  if (result.result !== "PASS") process.exitCode = 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { executeRestoreReconcile, syntheticInput };
