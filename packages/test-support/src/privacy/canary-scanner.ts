import { createHash } from "node:crypto";

export const syntheticPrivacyCanaries = Object.freeze([
  { id: "canary.auth-token", marker: "CM_SYNTH_AUTH_8d62c9a4" },
  { id: "canary.detector-candidate", marker: "CM_SYNTH_DETECT_5a17e2bf" },
  { id: "canary.financial-content", marker: "CM_SYNTH_FIN_7c49d130" },
  { id: "canary.identity", marker: "CM_SYNTH_ID_2f806cab" },
  { id: "canary.search", marker: "CM_SYNTH_SEARCH_93bd40e1" },
] as const);

export type PrivacyCanaryChannel =
  | "browser_diagnostics"
  | "evidence"
  | "job_error"
  | "logs"
  | "metrics"
  | "product_error"
  | "provider_metadata"
  | "support"
  | "traces"
  | "urls";

export interface CanarySurface {
  readonly channel: PrivacyCanaryChannel;
  readonly content: string;
  readonly locationClass: string;
}

export interface CanaryScanResult {
  readonly canaryId: string;
  readonly channel: PrivacyCanaryChannel;
  readonly locationClass: string;
  readonly markerHash: string;
  readonly result: "fail" | "pass";
}

export class PrivacyCanaryLeakError extends Error {
  constructor(readonly findings: readonly CanaryScanResult[]) {
    super("PRIVACY_CANARY_LEAK_DETECTED");
    this.name = "PrivacyCanaryLeakError";
  }
}

export function scanPrivacyCanaries(
  surfaces: readonly CanarySurface[],
): readonly CanaryScanResult[] {
  const results = surfaces.flatMap((surface) =>
    syntheticPrivacyCanaries.map((canary) => ({
      canaryId: canary.id,
      channel: surface.channel,
      locationClass: surface.locationClass,
      markerHash: createHash("sha256").update(canary.id).digest("hex"),
      result: surface.content.includes(canary.marker) ? ("fail" as const) : ("pass" as const),
    })),
  );
  const failures = results.filter((result) => result.result === "fail");
  if (failures.length > 0) throw new PrivacyCanaryLeakError(Object.freeze(failures));
  return Object.freeze(results);
}
