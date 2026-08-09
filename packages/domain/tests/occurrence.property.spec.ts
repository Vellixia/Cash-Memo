import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  OccurrenceValidationError,
  occurrenceFromInstant,
  resolveLocalOccurrence,
  resolveRelativeDate,
  validateOccurrenceTuple,
} from "../src/time/occurrence.js";
import { reportingMonthBounds } from "../src/time/reporting-period.js";

const now = "2026-08-09T05:30:00Z";
const tzdbVersion = "2025b";

describe("occurrence and reporting-time contracts", () => {
  it("validates the authoritative instant/local/IANA/offset/tzdb tuple", () => {
    expect(
      validateOccurrenceTuple(
        {
          occurredAt: "2026-08-09T05:30:00Z",
          occurredLocal: "2026-08-09T12:30:00",
          occurredOffsetMinutes: 420,
          occurredTimezone: "Asia/Jakarta",
          timezoneDatabaseVersion: tzdbVersion,
        },
        { now },
      ),
    ).toEqual({
      occurredAt: "2026-08-09T05:30:00Z",
      occurredLocal: "2026-08-09T12:30:00",
      occurredOffsetMinutes: 420,
      occurredTimezone: "Asia/Jakarta",
      timezoneDatabaseVersion: tzdbVersion,
    });
  });

  it.each([
    ["instant/local mismatch", { occurredLocal: "2026-08-09T12:31:00" }],
    ["offset mismatch", { occurredOffsetMinutes: 480 }],
    ["invalid zone", { occurredTimezone: "Jakarta" }],
    ["missing instant offset", { occurredAt: "2026-08-09T05:30:00" }],
    ["invalid local suffix", { occurredLocal: "2026-08-09T12:30:00Z" }],
    ["invalid offset bound", { occurredOffsetMinutes: 841 }],
    ["missing tzdb version", { timezoneDatabaseVersion: "" }],
  ])("rejects %s without coercion", (_caseName, override) => {
    const candidate = {
      occurredAt: "2026-08-09T05:30:00Z",
      occurredLocal: "2026-08-09T12:30:00",
      occurredOffsetMinutes: 420,
      occurredTimezone: "Asia/Jakarta",
      timezoneDatabaseVersion: tzdbVersion,
      ...override,
    };

    expect(() => validateOccurrenceTuple(candidate, { now })).toThrow(OccurrenceValidationError);
  });

  it("allows exactly five future minutes and rejects anything later", () => {
    expect(() =>
      validateOccurrenceTuple(
        occurrenceFromInstant({
          occurredAt: "2026-08-09T05:35:00Z",
          occurredTimezone: "Asia/Jakarta",
          timezoneDatabaseVersion: tzdbVersion,
        }),
        { now },
      ),
    ).not.toThrow();
    expect(() =>
      validateOccurrenceTuple(
        occurrenceFromInstant({
          occurredAt: "2026-08-09T05:35:00.001Z",
          occurredTimezone: "Asia/Jakarta",
          timezoneDatabaseVersion: tzdbVersion,
        }),
        { now },
      ),
    ).toThrow(expect.objectContaining({ code: "OCCURRENCE_TOO_FAR_IN_FUTURE" }));
  });

  it("returns visible correction states for DST gaps and repetitions", () => {
    const nonexistent = resolveLocalOccurrence({
      occurredLocal: "2026-03-08T02:30:00",
      occurredTimezone: "America/New_York",
      timezoneDatabaseVersion: tzdbVersion,
    });
    const ambiguous = resolveLocalOccurrence({
      occurredLocal: "2026-11-01T01:30:00",
      occurredTimezone: "America/New_York",
      timezoneDatabaseVersion: tzdbVersion,
    });

    expect(nonexistent).toMatchObject({ status: "nonexistent" });
    expect(ambiguous.status).toBe("ambiguous");
    if (ambiguous.status === "ambiguous") {
      expect(ambiguous.alternatives).toHaveLength(2);
      expect(ambiguous.alternatives.map((value) => value.occurredOffsetMinutes)).toEqual([
        -240, -300,
      ]);
      expect(ambiguous.alternatives[0].occurredAt < ambiguous.alternatives[1].occurredAt).toBe(
        true,
      );
    }
  });

  it("anchors assisted relative dates to immutable capture start in reporting timezone", () => {
    const anchor = {
      captureStartedAt: "2026-08-31T23:30:00Z",
      reportingTimezone: "Asia/Jakarta",
    };

    expect(resolveRelativeDate({ ...anchor, relativeDay: "today" })).toBe("2026-09-01");
    expect(resolveRelativeDate({ ...anchor, relativeDay: "yesterday" })).toBe("2026-08-31");
  });

  it("constructs half-open month boundaries in the current reporting timezone", () => {
    expect(reportingMonthBounds({ month: "2026-08", reportingTimezone: "Asia/Jakarta" })).toEqual({
      endExclusive: "2026-08-31T17:00:00Z",
      startInclusive: "2026-07-31T17:00:00Z",
    });
    expect(
      reportingMonthBounds({ month: "2026-03", reportingTimezone: "America/New_York" }),
    ).toEqual({
      endExclusive: "2026-04-01T04:00:00Z",
      startInclusive: "2026-03-01T05:00:00Z",
    });
  });

  it("round-trips generated instants across representative IANA zones", () => {
    const zones = [
      "America/New_York",
      "Asia/Jakarta",
      "Asia/Kathmandu",
      "Australia/Sydney",
      "Europe/London",
      "Pacific/Auckland",
      "UTC",
    ] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...zones),
        fc.integer({ min: 1_577_836_800, max: 1_924_991_999 }),
        (occurredTimezone, epochSeconds) => {
          const occurredAt = new Date(epochSeconds * 1000).toISOString();
          const occurrence = occurrenceFromInstant({
            occurredAt,
            occurredTimezone,
            timezoneDatabaseVersion: tzdbVersion,
          });

          expect(validateOccurrenceTuple(occurrence, { now: "2031-01-01T00:00:00Z" })).toEqual(
            occurrence,
          );
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
