import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  calculateMonthlyReview,
  type MonthlyReviewCandidate,
} from "../../packages/domain/src/index.js";

import {
  monthlyReviewExportRows,
  REVIEW_PRIOR_BOUNDS,
  REVIEW_SELECTED_BOUNDS,
} from "../../apps/server/tests/fixtures/reporting/monthly-review-golden.js";

const ROOT = resolve(import.meta.dirname, "../..");
const PRODUCTION_FILES = [
  "packages/domain/src/reporting/monthly-review.ts",
  "apps/server/src/modules/reporting/monthly-review.service.ts",
  "apps/server/src/modules/reporting/monthly-review.controller.ts",
  "apps/web/src/features/reporting/MonthlyReview.tsx",
] as const;

const forbiddenIdentifiers = [
  "open" + "ai",
  "anth" + "ropic",
  "exchange" + "Rate",
  "base" + "Currency",
  "converted" + "Total",
  "grand" + "Total",
  "generated" + "Insight",
  "financial" + "Advice",
  "prediction" + "Provider",
  "embedding" + "Client",
] as const;

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

describe("monthly review scope security", () => {
  it("has no generated-narrative, prediction, conversion, or base-currency identifier path", () => {
    for (const path of PRODUCTION_FILES) {
      const text = source(path);
      for (const identifier of forbiddenIdentifiers) {
        expect(text, `${path} contains ${identifier}`).not.toContain(identifier);
      }
    }
  });

  it("invokes only inward domain, transaction, HTTP, session, and React/API dependencies", () => {
    const imports = PRODUCTION_FILES.flatMap((path) =>
      [...source(path).matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]),
    );
    expect(imports).toEqual(
      expect.arrayContaining([
        "@cashmemo/domain",
        "../../adapters/postgres/transaction-context.js",
        "react",
      ]),
    );
    expect(imports.join("\n")).not.toMatch(
      /provider|vector|embedding|exchange|forex|anthropic|openai/iu,
    );
  });

  it("keeps IDR and USD as independent sections with no consolidated financial scalar", () => {
    const records = monthlyReviewExportRows.map((row): MonthlyReviewCandidate => ({
      amountMinor: row.amountMinor,
      authority: row.authority,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryNormalizedName: row.categoryNormalizedName,
      currency: row.currency,
      currencyExponent: row.currencyExponent,
      direction: row.direction,
      lifecycle: row.lifecycle,
      moneySpaceId: row.moneySpaceId,
      occurredAt: row.occurredAt,
      planningStatus: row.planningStatus,
      purpose: row.purpose,
    }));
    const result = calculateMonthlyReview({
      priorBounds: REVIEW_PRIOR_BOUNDS,
      records,
      selectedBounds: REVIEW_SELECTED_BOUNDS,
    });
    expect(result.some((section) => section.currency === "IDR")).toBe(true);
    expect(result.some((section) => section.currency === "USD")).toBe(true);
    expect(Object.keys(result)).not.toEqual(
      expect.arrayContaining(["grandTotal", "baseCurrency", "convertedTotal"]),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /grandTotal|baseCurrency|convertedTotal|exchangeRate|narrative|advice|prediction/iu,
    );
  });
});
