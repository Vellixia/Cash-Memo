import { describe, expect, test } from "bun:test";
import { dateRangeLabel } from "./format";

describe("dateRangeLabel", () => {
  test("same month collapses to a day range", () => {
    expect(dateRangeLabel("2026-10-01", "2026-10-09")).toBe("Oct 1–9");
    expect(dateRangeLabel("2026-10-09", "2026-10-09")).toBe("Oct 9");
  });
  test("spans months", () => {
    expect(dateRangeLabel("2026-08-01", "2026-10-09")).toBe("Aug 1 – Oct 9");
  });
  test("spans years", () => {
    expect(dateRangeLabel("2025-12-01", "2026-01-09")).toBe("Dec 1, 2025 – Jan 9, 2026");
  });
});
