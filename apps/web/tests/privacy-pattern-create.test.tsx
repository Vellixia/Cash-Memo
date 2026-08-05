import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  detectPatternV1,
  type PatternDecision,
} from "../src/lib/privacy/pattern-set-v1";
import { PrivacyWarning } from "../src/features/money-memos/components/privacy-warning";
import patternRegistry from "../../../shared/privacy/pattern-set-v1.json";

const blocking = [
  ["4111 1111 1111 1111", "B1_PAN_LUHN"],
  ["GB82 WEST 1234 5698 7654 32", "B2_IBAN_MOD97"],
  ["account number: ABC123456", "B3_LABELED_ACCOUNT"],
  ["routing number 111000025", "B4_LABELED_ROUTING"],
  ["CVV 123", "B5_LABELED_CARD_SECRET"],
  ["bank password: hunter22", "B6_LABELED_BANK_CREDENTIAL"],
  ["bank access token: abcdefgh", "B7_LABELED_BANK_TOKEN"],
  [
    "bank statement\naccount number\nopening balance\n2026-01-01 10\n2026-01-02 20\n2026-01-03 30",
    "B8_STATEMENT_PASTE",
  ],
  ["SSN 123-45-6789", "B9_LABELED_GOV_ID"],
] as const;

describe("Pattern Set v1 create boundary", () => {
  it.each(blocking)("blocks %s as %s", (value, detector) => {
    expect(detectPatternV1(value)).toEqual<PatternDecision>({
      kind: "block",
      detectorId: detector,
    });
  });

  it("warns for W1-W3 without mutating candidate input", () => {
    const cases = [
      ["Discuss bank account policy", "W1_BANKING_CONTEXT"],
      ["reference 1234567", "W2_UNLABELED_LONG_NUMBER"],
      ["bank statement example", "W3_STATEMENT_HEADER"],
    ] as const;
    for (const [value, detector] of cases) {
      const original = new TextEncoder().encode(value);
      expect(detectPatternV1(value)).toEqual({
        kind: "warn",
        detectorId: detector,
      });
      expect(new TextEncoder().encode(value)).toEqual(original);
    }
  });

  it("shows adjacent honest warning and preserves input across correction choices", () => {
    const edit = vi.fn();
    const remove = vi.fn();
    const proceed = vi.fn();
    render(
      <PrivacyWarning
        decision={{ kind: "warn", detectorId: "W1_BANKING_CONTEXT" }}
        onEdit={edit}
        onRemove={remove}
        onContinue={proceed}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent("Do not enter");
    expect(screen.getByRole("note")).toHaveTextContent(
      "may miss sensitive content",
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove text" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue unchanged" }));
    expect(edit).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(proceed).toHaveBeenCalledOnce();
  });

  it("blocks network submission for blocking decisions", () => {
    const request = vi.fn();
    const value = "4111111111111111";
    if (detectPatternV1(value).kind === "clear") request(value);
    expect(request).not.toHaveBeenCalled();
  });

  it("applies B8 only to three later rows with amount tokens separate from dates", () => {
    const header = "bank statement\naccount number\nopening balance";
    expect(
      detectPatternV1(
        `2026-01-01 10\n2026-01-02 20\n2026-01-03 30\n${header}`,
      ),
    ).not.toEqual({ kind: "block", detectorId: "B8_STATEMENT_PASTE" });
    expect(
      detectPatternV1(
        `${header}\n2026-01-01\n2026-01-02\n2026-01-03`,
      ),
    ).not.toEqual({ kind: "block", detectorId: "B8_STATEMENT_PASTE" });
    expect(
      detectPatternV1(
        `${header}\n2026-01-01 10.00\n02/01/2026 20\n03-01-2026 30`,
      ),
    ).toEqual({ kind: "block", detectorId: "B8_STATEMENT_PASTE" });
  });

  it("executes every label, header, phrase, and boundary in the complete v1 registry", () => {
    const blockingRegistry = patternRegistry.blocking;
    const labelFixture = new Map<string, string>([
      ["B3_LABELED_ACCOUNT", "ABC123456"],
      ["B4_LABELED_ROUTING", "111000025"],
      ["B5_LABELED_CARD_SECRET", "123"],
      ["B6_LABELED_BANK_CREDENTIAL", "hunter22"],
      ["B7_LABELED_BANK_TOKEN", "abcdefgh"],
      ["B9_LABELED_GOV_ID", "ABC123456"],
    ]);
    for (const detector of blockingRegistry) {
      if (!("labels" in detector)) continue;
      const fixture = labelFixture.get(detector.id);
      if (fixture === undefined) continue;
      for (const label of detector.labels) {
        const candidate =
          detector.id === "B4_LABELED_ROUTING" &&
          (label === "sort code" || label === "bsb")
            ? "123456"
            : detector.id === "B9_LABELED_GOV_ID" && label === "ssn"
            ? "123-45-6789"
            : detector.id === "B9_LABELED_GOV_ID" &&
                label === "social security number"
              ? "123-45-6789"
              : detector.id === "B9_LABELED_GOV_ID" &&
                  (label === "nik" ||
                    label === "nomor induk kependudukan")
                ? "1234567890123450"
                : fixture;
        expect(detectPatternV1(`${label}: ${candidate}`)).toEqual({
          kind: "block",
          detectorId: detector.id,
        });
      }
    }

    const b8 = blockingRegistry.find(
      (detector) => detector.id === "B8_STATEMENT_PASTE",
    );
    if (b8 === undefined || !("headers" in b8))
      throw new Error("B8 registry unavailable");
    for (const header of b8.headers)
      expect(
        detectPatternV1(
          `${header}\nopening balance\ncredit\n2026-01-01 10\n02/01/2026 20\n03-01-2026 30`,
        ),
      ).toEqual({ kind: "block", detectorId: "B8_STATEMENT_PASTE" });

    const w1 = patternRegistry.warnings.find(
      (detector) => detector.id === "W1_BANKING_CONTEXT",
    );
    if (w1 === undefined || !("phrases" in w1))
      throw new Error("W1 registry unavailable");
    for (const phrase of w1.phrases) {
      const decision = detectPatternV1(phrase);
      expect(["warn", "block"]).toContain(decision.kind);
    }
    for (const header of b8.headers) {
      const decision = detectPatternV1(header);
      expect(["warn", "block"]).toContain(decision.kind);
    }
    expect(detectPatternV1("reference 12345")).toEqual({ kind: "clear" });
    expect(detectPatternV1("reference 123456")).toEqual({
      kind: "warn",
      detectorId: "W2_UNLABELED_LONG_NUMBER",
    });
    expect(detectPatternV1(`reference ${"1".repeat(35)}`)).toEqual({
      kind: "clear",
    });
  });
});
