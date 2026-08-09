import registryData from "../data/registry-v1.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import {
  CurrencyRegistry,
  CurrencyRegistryValidationError,
  currencyRegistryV1,
} from "../src/registry.js";

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, entry]) => [key, ...allKeys(entry)]);
}

describe("currency registry v1", () => {
  it("loads a canonical, sorted, enabled allowlist with reviewed exponents", () => {
    expect(currencyRegistryV1.version).toBe("cldr47-iso4217-2026-01-01-cashmemo-v1");
    expect(currencyRegistryV1.entries).toHaveLength(21);
    expect(currencyRegistryV1.entries.map((entry) => entry.code)).toEqual(
      [...currencyRegistryV1.entries.map((entry) => entry.code)].sort(),
    );
    expect(currencyRegistryV1.get("IDR")?.exponent).toBe(2);
    expect(currencyRegistryV1.get("JPY")?.exponent).toBe(0);
    expect(currencyRegistryV1.get("KWD")?.exponent).toBe(3);
    expect(currencyRegistryV1.get("usd")).toBeUndefined();
    expect(currencyRegistryV1.get("ZZZ")).toBeUndefined();
  });

  it("contains no valuation, exchange, conversion, or rate fields", () => {
    expect(
      allKeys(registryData).filter((key) => /(?:conversion|exchange|rate)/iu.test(key)),
    ).toEqual([]);
  });

  it("fails closed if a future source adds an unreviewed or rate-like field", () => {
    const candidate = structuredClone(registryData) as unknown as Record<string, unknown>;
    candidate["exchangeRate"] = "not-allowed";

    expect(() => new CurrencyRegistry(candidate)).toThrow(CurrencyRegistryValidationError);
  });
});
