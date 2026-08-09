import { currencyRegistryV1 } from "@cashmemo/currency-registry";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  Money,
  MoneyValidationError,
  parseMoney,
  serializeMoney,
  sumMoneyByCurrency,
} from "../src/money/money.js";

const exponentByCurrency = {
  IDR: 2,
  JPY: 0,
  KWD: 3,
  USD: 2,
} as const;

function decimalFromMinor(amountMinor: bigint, exponent: number): string {
  const digits = amountMinor.toString().padStart(exponent + 1, "0");
  if (exponent === 0) return digits;
  const fraction = digits.slice(-exponent).replace(/0+$/u, "");
  return fraction.length === 0
    ? digits.slice(0, -exponent)
    : `${digits.slice(0, -exponent)}.${fraction}`;
}

describe("exact Money contracts", () => {
  it("parses canonical positive decimals into exact integer minor units", () => {
    expect(
      serializeMoney(parseMoney({ amount: "85000", currency: "IDR" }, currencyRegistryV1)),
    ).toEqual({
      amount: "85000",
      amountMinor: "8500000",
      currency: "IDR",
      currencyExponent: 2,
      currencyRegistryVersion: currencyRegistryV1.version,
    });
    expect(
      serializeMoney(parseMoney({ amount: "12.34", currency: "USD" }, currencyRegistryV1)),
    ).toMatchObject({ amount: "12.34", amountMinor: "1234", currencyExponent: 2 });
  });

  it.each([
    ["zero", { amount: "0", currency: "USD" }],
    ["decimal zero", { amount: "0.00", currency: "USD" }],
    ["negative", { amount: "-1", currency: "USD" }],
    ["explicit plus", { amount: "+1", currency: "USD" }],
    ["leading zero", { amount: "01", currency: "USD" }],
    ["leading decimal point", { amount: ".5", currency: "USD" }],
    ["trailing decimal point", { amount: "1.", currency: "USD" }],
    ["exponent notation", { amount: "1e3", currency: "USD" }],
    ["separator", { amount: "1,000", currency: "USD" }],
    ["whitespace", { amount: " 1", currency: "USD" }],
    ["non-finite text", { amount: "Infinity", currency: "USD" }],
    ["JSON number", { amount: 1, currency: "USD" }],
    ["lowercase currency", { amount: "1", currency: "usd" }],
    ["unsupported currency", { amount: "1", currency: "ZZZ" }],
    ["over-precision", { amount: "1.001", currency: "USD" }],
    ["fraction for exponent zero", { amount: "1.1", currency: "JPY" }],
    ["over 15 significant digits", { amount: "1000000000000000", currency: "IDR" }],
  ])("rejects %s before authority", (_caseName, candidate) => {
    expect(() => parseMoney(candidate, currencyRegistryV1)).toThrow(MoneyValidationError);
  });

  it("rejects signed-64 overflow during persistence hydration", () => {
    expect(() =>
      Money.fromMinor({
        amountMinor: "9223372036854775808",
        currency: "USD",
        currencyExponent: 2,
        currencyRegistryVersion: currencyRegistryV1.version,
      }),
    ).toThrow(MoneyValidationError);
  });

  it("round-trips 10,000 positive values without binary floating point", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<keyof typeof exponentByCurrency>("IDR", "JPY", "USD", "KWD"),
        fc.bigInt({ min: 1n, max: 999_999_999_999_999n }),
        (currency, amountMinor) => {
          const exponent = exponentByCurrency[currency];
          const amount = decimalFromMinor(amountMinor, exponent);

          const serialized = serializeMoney(parseMoney({ amount, currency }, currencyRegistryV1));
          expect(serialized.amountMinor).toBe(amountMinor.toString());
          expect(serialized.amount).toBe(amount);
          expect(serialized.currency).toBe(currency);
          expect(serialized.currencyExponent).toBe(exponent);
        },
      ),
      { numRuns: 10_000 },
    );
  });

  it("partitions exact sums by currency and never emits one mixed scalar", () => {
    const values = [
      parseMoney({ amount: "85000", currency: "IDR" }, currencyRegistryV1),
      parseMoney({ amount: "15000", currency: "IDR" }, currencyRegistryV1),
      parseMoney({ amount: "12.34", currency: "USD" }, currencyRegistryV1),
      parseMoney({ amount: "0.66", currency: "USD" }, currencyRegistryV1),
    ];

    expect(sumMoneyByCurrency(values)).toEqual([
      {
        amountMinor: "10000000",
        currency: "IDR",
        currencyExponent: 2,
        currencyRegistryVersion: currencyRegistryV1.version,
      },
      {
        amountMinor: "1300",
        currency: "USD",
        currencyExponent: 2,
        currencyRegistryVersion: currencyRegistryV1.version,
      },
    ]);
    expect(sumMoneyByCurrency([])).toEqual([]);
  });
});
