interface RestoreReconcileInput {
  accountFirstComplete: boolean;
  allRequiredKeysAvailable: boolean;
  ledgerAvailable: boolean;
  memoMatchingComplete: boolean;
  networkIsolated: boolean;
  sessionsRevoked: boolean;
  sweepersComplete: boolean;
  verificationComplete: boolean;
}
interface RestoreReconcileOutput {
  checklist: "blocked" | "complete";
  result: "BLOCKED" | "PASS";
  safeBlockerClass: string | null;
}
export function executeRestoreReconcile(input: RestoreReconcileInput): RestoreReconcileOutput;
export function syntheticInput(mode: string): RestoreReconcileInput;
