const SAFE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;

export interface ClockSnapshot {
  readonly instant: string;
  readonly reportingTimezone: string;
  readonly timezoneDatabaseVersion: string;
}

export interface ControlledDeadline {
  readonly deadlineEpochMilliseconds: number;
}

export type DeadlineStatus =
  | { readonly state: "pending"; readonly remainingMilliseconds: number }
  | { readonly state: "due"; readonly remainingMilliseconds: 0 };

export class ControlledClockError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid controlled clock operation: ${reason}`);
    this.name = "ControlledClockError";
  }
}

function canonicalInstant(value: string | Date): Date {
  const parsed = typeof value === "string" ? new Date(value) : new Date(value.valueOf());
  if (Number.isNaN(parsed.valueOf())) throw new ControlledClockError("instant_invalid");
  if (typeof value === "string" && parsed.toISOString() !== value) {
    throw new ControlledClockError("instant_not_canonical");
  }
  return parsed;
}

function validateTimezone(timezone: string): void {
  try {
    const canonical = new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions()
      .timeZone;
    if (canonical !== timezone) throw new ControlledClockError("timezone_not_canonical");
  } catch (error: unknown) {
    if (error instanceof ControlledClockError) throw error;
    throw new ControlledClockError("timezone_invalid");
  }
}

function validateDuration(milliseconds: number): void {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new ControlledClockError("duration_invalid");
  }
}

export class ControlledClock {
  private currentEpochMilliseconds: number;
  private currentReportingTimezone: string;
  private currentTimezoneDatabaseVersion: string;

  constructor(snapshot: ClockSnapshot) {
    const instant = canonicalInstant(snapshot.instant);
    validateTimezone(snapshot.reportingTimezone);
    if (!SAFE_VERSION_PATTERN.test(snapshot.timezoneDatabaseVersion)) {
      throw new ControlledClockError("tzdb_version_invalid");
    }
    this.currentEpochMilliseconds = instant.valueOf();
    this.currentReportingTimezone = snapshot.reportingTimezone;
    this.currentTimezoneDatabaseVersion = snapshot.timezoneDatabaseVersion;
  }

  now(): Date {
    return new Date(this.currentEpochMilliseconds);
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  snapshot(): ClockSnapshot {
    return Object.freeze({
      instant: this.nowIso(),
      reportingTimezone: this.currentReportingTimezone,
      timezoneDatabaseVersion: this.currentTimezoneDatabaseVersion,
    });
  }

  advanceBy(milliseconds: number): void {
    validateDuration(milliseconds);
    const next = this.currentEpochMilliseconds + milliseconds;
    if (!Number.isSafeInteger(next)) throw new ControlledClockError("instant_overflow");
    this.currentEpochMilliseconds = next;
  }

  setInstant(instant: string): void {
    this.currentEpochMilliseconds = canonicalInstant(instant).valueOf();
  }

  setReportingTimezone(timezone: string): void {
    validateTimezone(timezone);
    this.currentReportingTimezone = timezone;
  }

  setTimezoneDatabaseVersion(version: string): void {
    if (!SAFE_VERSION_PATTERN.test(version)) {
      throw new ControlledClockError("tzdb_version_invalid");
    }
    this.currentTimezoneDatabaseVersion = version;
  }

  deadlineAfter(milliseconds: number): ControlledDeadline {
    validateDuration(milliseconds);
    const deadlineEpochMilliseconds = this.currentEpochMilliseconds + milliseconds;
    if (!Number.isSafeInteger(deadlineEpochMilliseconds)) {
      throw new ControlledClockError("deadline_overflow");
    }
    return Object.freeze({ deadlineEpochMilliseconds });
  }

  deadlineStatus(deadline: ControlledDeadline): DeadlineStatus {
    if (!Number.isSafeInteger(deadline.deadlineEpochMilliseconds)) {
      throw new ControlledClockError("deadline_invalid");
    }
    const remaining = deadline.deadlineEpochMilliseconds - this.currentEpochMilliseconds;
    return remaining <= 0
      ? { remainingMilliseconds: 0, state: "due" }
      : { remainingMilliseconds: remaining, state: "pending" };
  }

  fork(): ControlledClock {
    return new ControlledClock(this.snapshot());
  }
}
