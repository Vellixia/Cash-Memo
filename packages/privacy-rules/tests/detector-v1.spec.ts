import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { privacyRuleFamilies, type PrivacyRuleFamily } from "../src/contracts.js";
import { detectTextV1, detectorV1RuleSetVersion } from "../src/detector-v1.js";

interface CorpusCase {
  readonly expectedRuleFamily: PrivacyRuleFamily | null;
  readonly id: string;
  readonly text: string;
}

const corpus = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../fixtures/corpus-v1.json"), "utf8"),
) as { cases: CorpusCase[]; schemaVersion: string; syntheticOnly: boolean };

describe("privacy detector v1 synthetic corpus", () => {
  it("is explicitly versioned and synthetic", () => {
    expect(detectorV1RuleSetVersion).toBe("privacy-detector-v1");
    expect(corpus.schemaVersion).toBe("cashmemo-privacy-detector-corpus-v1");
    expect(corpus.syntheticOnly).toBe(true);
    expect(corpus.cases.length).toBeGreaterThanOrEqual(40);
  });

  it.each(corpus.cases)("classifies $id", ({ expectedRuleFamily, text }) => {
    const result = detectTextV1(text);
    expect(result.ruleFamily).toBe(expectedRuleFamily);
    expect(result.decision).toBe(expectedRuleFamily === null ? "allow" : "block_match");
    expect(result).not.toHaveProperty("candidate");
    expect(result).not.toHaveProperty("span");
    expect(result).not.toHaveProperty("normalized");
  });

  it.each(privacyRuleFamilies)("measures exact precision/recall for %s", (family) => {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    for (const item of corpus.cases) {
      const actual = detectTextV1(item.text).ruleFamily;
      if (actual === family && item.expectedRuleFamily === family) truePositive += 1;
      if (actual === family && item.expectedRuleFamily !== family) falsePositive += 1;
      if (actual !== family && item.expectedRuleFamily === family) falseNegative += 1;
    }
    const precision = truePositive / (truePositive + falsePositive);
    const recall = truePositive / (truePositive + falseNegative);
    expect({ falseNegative, falsePositive, precision, recall }).toEqual({
      falseNegative: 0,
      falsePositive: 0,
      precision: 1,
      recall: 1,
    });
  });

  it("makes no semantic-completeness claim", () => {
    const unknown = detectTextV1("a secret described without any supported finite pattern");
    expect(unknown.decision).toBe("allow");
  });
});
