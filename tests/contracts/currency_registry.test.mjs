import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registryPath = new URL(
  "../../shared/currencies/iso4217-list-one-2026-01-01.json",
  import.meta.url,
);

test("pinned registry is immutable, ordered, unique, and scale-bounded", () => {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  assert.equal(registry.version, "iso4217-list-one-2026-01-01");
  assert.equal(registry.sourceEffectiveDate, "2026-01-01");
  assert.equal(
    registry.sourceSha256,
    "838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9",
  );
  assert.ok(registry.currencies.length > 100);
  const codes = registry.currencies.map(({ code }) => code);
  assert.deepEqual(codes, [...codes].sort());
  assert.equal(new Set(codes).size, codes.length);
  for (const currency of registry.currencies) {
    assert.match(currency.code, /^[A-Z]{3}$/);
    assert.ok(Number.isInteger(currency.minorUnitScale));
    assert.ok(currency.minorUnitScale >= 0 && currency.minorUnitScale <= 4);
  }
});

test("update policy remains explicit", () => {
  const contract = readFileSync(
    new URL(
      "../../specs/001-money-memo-foundation/contracts/currencies-v1.md",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(contract, /Updating currencies requires new registry ID/);
  assert.match(contract, /never converts or rewrites amount/);
});
