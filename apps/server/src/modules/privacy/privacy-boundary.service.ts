import {
  detectorV1RuleSetVersion,
  FinitePrivacyBoundary,
  textDetectorBoundaries,
  type PrivacyBoundaryPort,
  type PrivacyBoundaryResult,
  type TextDetectorBoundary,
} from "@cashmemo/privacy-rules";

const declaredBoundaries = new Set<TextDetectorBoundary>(textDetectorBoundaries);

export class PrivacyBoundaryBlockedError extends Error {
  constructor(readonly code = "PRIVACY_BOUNDARY_BLOCKED") {
    super(code);
    this.name = "PrivacyBoundaryBlockedError";
  }
}

/** Server-authoritative finite privacy boundary. No caller-supplied client decision is accepted. */
export class PrivacyBoundaryService implements PrivacyBoundaryPort {
  constructor(private readonly detector: PrivacyBoundaryPort = new FinitePrivacyBoundary()) {}

  async evaluateText(input: {
    readonly boundary: TextDetectorBoundary;
    readonly content: string;
    readonly ruleSetVersion: string;
  }): Promise<PrivacyBoundaryResult> {
    if (!declaredBoundaries.has(input.boundary)) {
      return Object.freeze({
        decision: "block_unavailable",
        matched: false,
        ruleFamily: null,
        warningCode: "PRIVACY_CHECK_UNAVAILABLE_TRY_AGAIN_OR_USE_STRUCTURED_ENTRY",
      });
    }
    if (input.ruleSetVersion !== detectorV1RuleSetVersion) {
      return Object.freeze({
        decision: "block_unavailable",
        matched: false,
        ruleFamily: null,
        warningCode: "PRIVACY_CHECK_UNAVAILABLE_TRY_AGAIN_OR_USE_STRUCTURED_ENTRY",
      });
    }
    try {
      const result = await this.detector.evaluateText({
        ...input,
        ruleSetVersion: detectorV1RuleSetVersion,
      });
      return Object.freeze({ ...result });
    } catch {
      return Object.freeze({
        decision: "block_unavailable",
        matched: false,
        ruleFamily: null,
        warningCode: "PRIVACY_CHECK_UNAVAILABLE_TRY_AGAIN_OR_USE_STRUCTURED_ENTRY",
      });
    }
  }

  async requireAllowed(boundary: TextDetectorBoundary, content: string): Promise<void> {
    const result = await this.evaluateText({
      boundary,
      content,
      ruleSetVersion: detectorV1RuleSetVersion,
    });
    if (result.decision !== "allow") throw new PrivacyBoundaryBlockedError();
  }
}
