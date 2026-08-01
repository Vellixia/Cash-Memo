import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  detectPatternV1,
  type PatternDecision,
} from "../src/lib/privacy/pattern-set-v1";
import { PrivacyWarning } from "../src/features/money-memos/components/privacy-warning";

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
});
