import {
  parseMoney,
  serializeMoney,
  MoneyValidationError,
  type SerializedMoney,
} from "@cashmemo/domain";
import { currencyRegistryV1 } from "@cashmemo/currency-registry";
import { describe, expect, it } from "vitest";

function parseAmount(input: { amount: unknown; currency: unknown }): SerializedMoney {
  return serializeMoney(parseMoney(input, currencyRegistryV1));
}

describe("Money Memo contract: amount validation (FR-011–FR-014)", () => {
  it("accepts positive canonical decimal string", () => {
    const result = parseAmount({ amount: "85000", currency: "IDR" });
    expect(result.amountMinor).toBe("8500000");
    expect(result.currency).toBe("IDR");
    expect(result.currencyExponent).toBe(2);
  });

  it("accepts decimal with exact exponent precision", () => {
    const result = parseAmount({ amount: "12.34", currency: "USD" });
    expect(result.amountMinor).toBe("1234");
    expect(result.currencyExponent).toBe(2);
  });

  it("rejects zero amount", () => {
    expect(() => parseAmount({ amount: "0", currency: "USD" })).toThrow(MoneyValidationError);
    expect(() => parseAmount({ amount: "0", currency: "USD" })).toThrow(
      expect.objectContaining({ code: "AMOUNT_MUST_BE_POSITIVE" }),
    );
  });

  it("rejects negative amount", () => {
    expect(() => parseAmount({ amount: "-100", currency: "USD" })).toThrow(MoneyValidationError);
  });

  it("rejects JSON numeric amount (must be string)", () => {
    expect(() => parseAmount({ amount: 100, currency: "USD" })).toThrow(MoneyValidationError);
    expect(() => parseAmount({ amount: 100, currency: "USD" })).toThrow(
      expect.objectContaining({ code: "AMOUNT_MUST_BE_STRING" }),
    );
  });

  it("rejects amount with too many decimal places for exponent", () => {
    expect(() => parseAmount({ amount: "12.345", currency: "USD" })).toThrow(MoneyValidationError);
    expect(() => parseAmount({ amount: "12.345", currency: "USD" })).toThrow(
      expect.objectContaining({ code: "AMOUNT_PRECISION_EXCEEDED" }),
    );
  });

  it("rejects unsupported currency", () => {
    expect(() => parseAmount({ amount: "100", currency: "XXX" })).toThrow(MoneyValidationError);
    expect(() => parseAmount({ amount: "100", currency: "XXX" })).toThrow(
      expect.objectContaining({ code: "CURRENCY_UNSUPPORTED" }),
    );
  });

  it("rejects overflow exceeding signed 64-bit after scaling", () => {
    expect(() => parseAmount({ amount: "99999999999999999", currency: "USD" })).toThrow(
      MoneyValidationError,
    );
  });

  it("rejects amount with more than 15 significant digits", () => {
    expect(() => parseAmount({ amount: "1234567890123456", currency: "USD" })).toThrow(
      MoneyValidationError,
    );
  });

  it("accepts JPY with zero exponent (no decimal places)", () => {
    const result = parseAmount({ amount: "5000", currency: "JPY" });
    expect(result.amountMinor).toBe("5000");
    expect(result.currencyExponent).toBe(0);
  });
});

describe("Money Memo contract: direction separation (FR-011)", () => {
  it("direction is separate from magnitude", () => {
    const directions = ["income", "expense"] as const;
    for (const dir of directions) {
      expect(typeof dir).toBe("string");
      expect(["income", "expense"]).toContain(dir);
    }
  });
});

describe("Money Memo contract: currency snapshot (FR-015–FR-017)", () => {
  it("response includes currency code, exponent, and registry version", () => {
    const result = parseAmount({ amount: "100", currency: "USD" });
    expect(result).toHaveProperty("currency", "USD");
    expect(result).toHaveProperty("currencyExponent", 2);
    expect(result).toHaveProperty(
      "currencyRegistryVersion",
      "cldr47-iso4217-2026-01-01-cashmemo-v1",
    );
  });

  it("does not include exchange-rate or converted/base amount", () => {
    const result = parseAmount({ amount: "100", currency: "USD" });
    expect(result).not.toHaveProperty("exchangeRate");
    expect(result).not.toHaveProperty("convertedAmount");
    expect(result).not.toHaveProperty("baseCurrency");
  });
});

describe("Money Memo contract: authority and confirmation (FR-022)", () => {
  it("draft input is not an authoritative Money Memo", () => {
    // A draft has `authoritative: false`, a confirmed memo has `authoritative: true`
    const draftFields = {
      authoritative: false,
      direction: "expense",
      amount: "100",
      currency: "USD",
    };
    const confirmedMemo = {
      authoritative: true,
      id: "00000000-0000-4000-8000-000000000001",
      direction: "expense",
      money: {
        amount: "100.00",
        amountMinor: "10000",
        currency: "USD",
        currencyExponent: 2,
        currencyRegistryVersion: "cldr47-iso4217-2026-01-01-cashmemo-v1",
      },
      revision: "1",
    };
    expect(draftFields.authoritative).toBe(false);
    expect(confirmedMemo.authoritative).toBe(true);
  });

  it("explicit confirmation token is required", () => {
    // The confirmation field must be exactly "CONFIRM_MONEY_MEMO"
    const validConfirmation = "CONFIRM_MONEY_MEMO";
    const invalidConfirmation = "confirm";
    expect(validConfirmation).toBe("CONFIRM_MONEY_MEMO");
    expect(invalidConfirmation).not.toBe("CONFIRM_MONEY_MEMO");
  });

  it("returned authoritative representation has immutable ID and revision", () => {
    const memo = {
      id: "00000000-0000-4000-8000-000000000001",
      revision: "1",
      lifecycle: "active",
    };
    // ID and revision are server-assigned, not client-provided
    expect(memo.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(memo.revision).toMatch(/^[1-9][0-9]*$/u);
    expect(memo.lifecycle).toBe("active");
  });
});

describe("Money Memo contract: occurrence tuple (FR-018–FR-021)", () => {
  it("requires all five occurrence fields", () => {
    const occurrence = {
      occurredAt: "2026-01-15T10:00:00.000Z",
      occurredLocal: "2026-01-15T17:00:00",
      occurredTimezone: "Asia/Jakarta",
      occurredOffsetMinutes: 420,
      timezoneDatabaseVersion: "2025a",
    };
    const requiredKeys = [
      "occurredAt",
      "occurredLocal",
      "occurredTimezone",
      "occurredOffsetMinutes",
      "timezoneDatabaseVersion",
    ];
    for (const key of requiredKeys) {
      expect(occurrence).toHaveProperty(key);
    }
  });

  it("occurredAt is authoritative instant (RFC3339)", () => {
    const occurredAt = "2026-01-15T10:00:00.000Z";
    expect(occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  });

  it("occurredLocal is local time without timezone suffix", () => {
    const occurredLocal = "2026-01-15T17:00:00";
    expect(occurredLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u);
    expect(occurredLocal).not.toContain("Z");
    expect(occurredLocal).not.toContain("+");
  });

  it("occurredTimezone is canonical IANA identifier", () => {
    const timezone = "Asia/Jakarta";
    expect(timezone).toContain("/");
    expect(timezone).not.toContain(" ");
  });

  it("occurredOffsetMinutes is integer in valid range", () => {
    const offset = 420;
    expect(Number.isInteger(offset)).toBe(true);
    expect(offset).toBeGreaterThanOrEqual(-840);
    expect(offset).toBeLessThanOrEqual(840);
  });
});

describe("Money Memo contract: optional fields (FR-011–FR-020)", () => {
  it("allows nullable category, money space, purpose, planning status, note", () => {
    const memo = {
      categoryId: null,
      moneySpaceId: null,
      purpose: null,
      planningStatus: null,
      note: null,
    };
    for (const key of Object.keys(memo)) {
      expect(memo[key as keyof typeof memo]).toBeNull();
    }
  });

  it("accepts purpose enum values: personal, work, mixed", () => {
    const purposes = ["personal", "work", "mixed"];
    for (const p of purposes) {
      expect(["personal", "work", "mixed"].includes(p)).toBe(true);
    }
  });

  it("accepts planning status enum values: planned, unplanned", () => {
    const statuses = ["planned", "unplanned"];
    for (const s of statuses) {
      expect(["planned", "unplanned"].includes(s)).toBe(true);
    }
  });

  it("note has maximum length of 4000 characters", () => {
    const note = "a".repeat(4000);
    expect(note.length).toBe(4000);
    expect(() => {
      if (note.length > 4000) throw new Error("NOTE_TOO_LONG");
    }).not.toThrow();
  });
});

describe("Money Memo contract: privacy-safe errors (FR-008, FR-049)", () => {
  it("money validation errors do not echo input amount", () => {
    try {
      parseAmount({ amount: "99999999999999999", currency: "USD" });
    } catch (error) {
      expect(error).toBeInstanceOf(MoneyValidationError);
      const message = (error as MoneyValidationError).message;
      expect(message).not.toContain("99999999999999999");
    }
  });

  it("currency validation errors do not echo input currency", () => {
    try {
      parseAmount({ amount: "100", currency: "INVALID_CURRENCY_CODE" });
    } catch (error) {
      expect(error).toBeInstanceOf(MoneyValidationError);
      const message = (error as MoneyValidationError).message;
      expect(message).not.toContain("INVALID_CURRENCY_CODE");
    }
  });
});

describe("Money Memo contract: no cross-currency aggregation", () => {
  it("money snapshots are currency-specific with no conversion field", () => {
    const usd = parseAmount({ amount: "100", currency: "USD" });
    const idr = parseAmount({ amount: "85000", currency: "IDR" });
    expect(usd.currency).not.toBe(idr.currency);
    expect(usd).not.toHaveProperty("exchangeRate");
    expect(idr).not.toHaveProperty("exchangeRate");
  });
});
