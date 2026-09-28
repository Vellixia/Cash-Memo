import { describe, expect, test } from "bun:test";
import { contrastRatio, PALETTE } from "./theme-palette";

const MIN = 4.5;

describe("accent palettes meet WCAG AA (>= 4.5:1) for text", () => {
  for (const [name, modes] of Object.entries(PALETTE)) {
    for (const [mode, t] of Object.entries(modes)) {
      test(`${name} ${mode}: foreground on background`, () => {
        expect(contrastRatio(t.foreground, t.background)).toBeGreaterThanOrEqual(MIN);
      });
      test(`${name} ${mode}: muted-foreground on background`, () => {
        expect(contrastRatio(t.mutedForeground, t.background)).toBeGreaterThanOrEqual(MIN);
      });
      test(`${name} ${mode}: primary-foreground on primary`, () => {
        expect(contrastRatio(t.primaryForeground, t.primary)).toBeGreaterThanOrEqual(MIN);
      });
    }
  }
});

test("contrastRatio is order-independent and 1:1 for identical colors", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
  expect(contrastRatio("#808080", "#808080")).toBeCloseTo(1, 5);
});
