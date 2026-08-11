import type {
  PrivacyBoundaryEvaluation,
  PrivacyBoundaryPort,
  PrivacyBoundaryResult,
} from "./contracts.js";
import { detectTextV1 } from "./detector-v1.js";

export class FinitePrivacyBoundary implements PrivacyBoundaryPort {
  evaluateText(evaluation: PrivacyBoundaryEvaluation): Promise<PrivacyBoundaryResult> {
    return Promise.resolve(detectTextV1(evaluation.content));
  }
}
