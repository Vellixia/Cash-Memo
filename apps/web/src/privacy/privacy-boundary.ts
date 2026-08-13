import {
  detectTextV1,
  detectorV1RuleSetVersion,
  type PrivacyBoundaryResult,
  type TextDetectorBoundary,
} from "@cashmemo/privacy-rules";

export interface BrowserPrivacyDecision {
  readonly decision: PrivacyBoundaryResult["decision"];
  readonly ruleFamily: PrivacyBoundaryResult["ruleFamily"];
  readonly ruleSetVersion: typeof detectorV1RuleSetVersion;
  readonly warningCode: PrivacyBoundaryResult["warningCode"];
}

/** UX-only early defense. Server independently repeats every covered check. */
export function evaluateBrowserPrivacy(
  _boundary: TextDetectorBoundary,
  content: string,
): BrowserPrivacyDecision {
  const result = detectTextV1(content);
  return Object.freeze({
    decision: result.decision,
    ruleFamily: result.ruleFamily,
    ruleSetVersion: detectorV1RuleSetVersion,
    warningCode: result.warningCode,
  });
}
