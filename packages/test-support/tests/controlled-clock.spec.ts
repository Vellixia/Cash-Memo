import { describe, expect, it } from "vitest";

import { ControlledClock, ControlledClockError } from "../src/time/controlled-clock.js";

const initial = {
  instant: "2026-08-09T08:00:00.000Z",
  reportingTimezone: "Asia/Jakarta",
  timezoneDatabaseVersion: "2025b",
} as const;

describe("ControlledClock", () => {
  it("controls exact instant, zone, tzdb version, and deadlines", () => {
    const clock = new ControlledClock(initial);
    const deadline = clock.deadlineAfter(60_000);
    expect(clock.deadlineStatus(deadline)).toEqual({
      remainingMilliseconds: 60_000,
      state: "pending",
    });
    clock.advanceBy(59_999);
    expect(clock.deadlineStatus(deadline)).toEqual({
      remainingMilliseconds: 1,
      state: "pending",
    });
    clock.advanceBy(1);
    expect(clock.deadlineStatus(deadline)).toEqual({
      remainingMilliseconds: 0,
      state: "due",
    });
  });

  it("forks without sharing later mutations", () => {
    const clock = new ControlledClock(initial);
    const fork = clock.fork();
    clock.advanceBy(1_000);
    clock.setReportingTimezone("UTC");
    clock.setTimezoneDatabaseVersion("2026a");
    expect(fork.snapshot()).toEqual(initial);
    expect(clock.snapshot()).toEqual({
      instant: "2026-08-09T08:00:01.000Z",
      reportingTimezone: "UTC",
      timezoneDatabaseVersion: "2026a",
    });
  });

  it.each([
    () => new ControlledClock({ ...initial, instant: "2026-08-09T08:00:00Z" }),
    () => new ControlledClock({ ...initial, reportingTimezone: "US/Eastern" }),
    () => new ControlledClock({ ...initial, timezoneDatabaseVersion: "bad version" }),
    () => {
      new ControlledClock(initial).advanceBy(-1);
    },
    () => {
      new ControlledClock(initial).advanceBy(1.5);
    },
  ])("rejects nondeterministic or noncanonical controls", (operation) => {
    expect(operation).toThrow(ControlledClockError);
  });
});
