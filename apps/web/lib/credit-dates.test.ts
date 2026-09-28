import { describe, expect, test } from "bun:test";
import { daysUntil, nextOccurrence } from "./credit-dates";

describe("nextOccurrence", () => {
  test("clamps to month end (day 31 in a 28-day February)", () => {
    expect(nextOccurrence(31, new Date(2026, 1, 1))).toEqual(new Date(2026, 1, 28));
  });

  test("rolls over to next month once this month's day has passed", () => {
    expect(nextOccurrence(5, new Date(2026, 2, 10))).toEqual(new Date(2026, 3, 5));
  });

  test("today counts as the occurrence, no roll-over", () => {
    expect(nextOccurrence(15, new Date(2026, 2, 15))).toEqual(new Date(2026, 2, 15));
  });
});

describe("daysUntil", () => {
  test("today is 0 days away", () => {
    expect(daysUntil(new Date(2026, 2, 15), new Date(2026, 2, 15))).toBe(0);
  });

  test("counts whole days ahead", () => {
    expect(daysUntil(new Date(2026, 2, 20), new Date(2026, 2, 15))).toBe(5);
  });
});
