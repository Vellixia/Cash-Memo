import { describe, expect, test } from "bun:test";
import {
  editAmount,
  exponent,
  fitAmount,
  formatAmountInput,
  formatMoney,
  fromMinor,
  guessCurrency,
  parseAmount,
  searchCurrencies,
  signedMoney,
  toMinor,
} from "./money";

// Engines differ on spaces (NBSP vs none), not on digits/separators.
const squash = (s: string) => s.replace(/\s/g, "");

/** Types `keys` one by one at the end of the field, like a user would. */
function type(currency: string, keys: string, start = "") {
  let text = formatAmountInput(start, currency);
  let value = start;
  for (const k of keys) {
    const next = text + k;
    ({ text, value } = editAmount(text, next, next.length, currency, "insertText"));
  }
  return { text, value };
}

describe("exponent", () => {
  test("is engine-independent for currencies engines disagree on", () => {
    expect(exponent("IDR")).toBe(0);
    expect(exponent("JPY")).toBe(0);
    expect(exponent("USD")).toBe(2);
    expect(exponent("KWD")).toBe(3);
  });
});

describe("formatMoney", () => {
  test("uses the currency's home locale", () => {
    expect(squash(formatMoney(7_500_000, "IDR"))).toBe("Rp7.500.000");
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(squash(formatMoney(123456, "EUR"))).toBe("1.234,56€");
    expect(formatMoney(12_345_678_90, "INR")).toBe("₹1,23,45,678.90");
    expect(squash(formatMoney(7500, "JPY"))).toMatch(/^[¥￥]7,500$/);
  });
  test("is exact for big amounts", () => {
    expect(formatMoney(900719925474099, "USD")).toBe("$9,007,199,254,740.99");
  });
  test("keeps the sign convention", () => {
    expect(signedMoney(-450, "USD")).toBe("−$4.50");
    expect(signedMoney(1200, "USD")).toBe("+$12.00");
    expect(squash(signedMoney(-75000, "IDR"))).toBe("−Rp75.000");
  });
});

describe("minor units", () => {
  test("round-trip with string math", () => {
    expect(toMinor("10.5", "USD")).toBe(1050);
    expect(toMinor("0.1", "USD") + toMinor("0.2", "USD")).toBe(30);
    expect(toMinor("75000", "IDR")).toBe(75000);
    expect(fromMinor(1050, "USD")).toBe("10.50");
    expect(fromMinor(5, "USD")).toBe("0.05");
    expect(fromMinor(75000, "IDR")).toBe("75000");
    expect(toMinor(fromMinor(123456789, "KWD"), "KWD")).toBe(123456789);
  });
});

describe("amount input", () => {
  test("groups natively as you type", () => {
    expect(type("IDR", "75000")).toEqual({ text: "75.000", value: "75000" });
    expect(type("USD", "1234.56")).toEqual({ text: "1,234.56", value: "1234.56" });
    expect(type("EUR", "1234,5")).toEqual({ text: "1.234,5", value: "1234.5" });
    expect(type("INR", "1234567")).toEqual({ text: "12,34,567", value: "1234567" });
  });
  test("either separator key is the decimal point; limited to the exponent", () => {
    expect(type("EUR", "12.5")).toEqual({ text: "12,5", value: "12.5" });
    expect(type("USD", "12,5")).toEqual({ text: "12.5", value: "12.5" });
    expect(type("USD", "1.239")).toEqual({ text: "1.23", value: "1.23" });
    expect(type("IDR", "75.5")).toEqual({ text: "755", value: "755" });
    expect(type("JPY", "1,000")).toEqual({ text: "1,000", value: "1000" });
    expect(type("USD", ".5").value).toBe("0.5");
    expect(type("USD", "..5").value).toBe("0.5");
  });
  test("drops junk and leading zeros", () => {
    expect(type("USD", "abc")).toEqual({ text: "", value: "" });
    expect(type("USD", "007")).toEqual({ text: "7", value: "7" });
    expect(type("USD", "0").value).toBe("0");
  });
  test("keeps the caret after the same digit", () => {
    // "1,000" -> type "5" after "1" -> "15,000", caret after "15," would be wrong; after "5" (index 2)
    const r = editAmount("1,000", "15,000", 2, "USD", "insertText");
    expect(r).toEqual({ value: "15000", text: "15,000", caret: 2 });
    // Backspace over a group separator deletes the digit before it: "75.|000" -> "7.000"
    expect(editAmount("75.000", "75000", 2, "IDR", "deleteContentBackward")).toEqual({ value: "7000", text: "7.000", caret: 1 });
    // Delete forward over it removes the digit after.
    expect(editAmount("75.000", "75000", 2, "IDR", "deleteContentForward")).toEqual({ value: "7500", text: "7.500", caret: 3 });
    // Deleting a digit that un-groups the number.
    expect(editAmount("1,234", "1,34", 2, "USD", "deleteContentBackward")).toEqual({ value: "134", text: "134", caret: 1 });
    // A typed digit in the middle of repeated digits.
    expect(editAmount("1,000", "1,0000", 3, "USD", "insertText")).toEqual({ value: "10000", text: "10,000", caret: 2 });
  });
  test("paste in either style", () => {
    expect(parseAmount("Rp 7.500.000", "IDR")).toBe("7500000");
    expect(parseAmount("75,000", "IDR")).toBe("75000");
    expect(parseAmount("1.234,56", "USD")).toBe("1234.56");
    expect(parseAmount("1,234.56", "EUR")).toBe("1234.56");
    expect(parseAmount("12,50", "USD")).toBe("12.50");
    expect(parseAmount("0.500", "USD")).toBe("0.50");
    expect(parseAmount("$1,234", "USD")).toBe("1234");
    expect(editAmount("", "1.234,56", 8, "EUR", "insertFromPaste")).toEqual({ value: "1234.56", text: "1.234,56", caret: 8 });
    // Selecting everything and filling a new value.
    expect(editAmount("12.50", "33.30", 5, "USD", "insertText").value).toBe("33.30");
  });
  test("refits to a new currency and caps size", () => {
    expect(fitAmount("12.50", "IDR")).toBe("12");
    expect(fitAmount("12.5", "KWD")).toBe("12.5");
    expect(type("USD", "99999999999999999").value).toBe("9999999999999");
  });
});

describe("picker + default", () => {
  test("search finds by name, code and symbol", () => {
    expect(searchCurrencies("rupiah")[0].code).toBe("IDR");
    expect(searchCurrencies("idr")[0].code).toBe("IDR");
    expect(searchCurrencies("euro").map((o) => o.code)).toContain("EUR");
  });
  test("guesses from the browser region", () => {
    expect(guessCurrency("id-ID")).toBe("IDR");
    expect(guessCurrency("en-US")).toBe("USD");
    expect(guessCurrency("de")).toBe("EUR");
    expect(guessCurrency("ja")).toBe("JPY");
    expect(guessCurrency("xx-invalid-!!")).toBe("USD");
  });
});
