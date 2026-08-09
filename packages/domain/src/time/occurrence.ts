import { Temporal } from "@js-temporal/polyfill";

const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const fiveMinutesNanoseconds = 300_000_000_000n;
const nanosecondsPerMinute = 60_000_000_000;

type OccurrenceValidationCode =
  | "OCCURRENCE_INSTANT_INVALID"
  | "OCCURRENCE_LOCAL_INVALID"
  | "OCCURRENCE_OFFSET_INVALID"
  | "OCCURRENCE_TIMEZONE_INVALID"
  | "OCCURRENCE_TOO_FAR_IN_FUTURE"
  | "OCCURRENCE_TUPLE_MISMATCH"
  | "OCCURRENCE_TZDB_VERSION_INVALID"
  | "RELATIVE_DATE_INVALID";

class OccurrenceValidationError extends Error {
  readonly code: OccurrenceValidationCode;

  constructor(code: OccurrenceValidationCode) {
    super(`Occurrence validation failed (${code}).`);
    this.name = "OccurrenceValidationError";
    this.code = code;
  }
}

interface Occurrence {
  readonly occurredAt: string;
  readonly occurredLocal: string;
  readonly occurredOffsetMinutes: number;
  readonly occurredTimezone: string;
  readonly timezoneDatabaseVersion: string;
}

interface OccurrenceTupleInput {
  readonly occurredAt: unknown;
  readonly occurredLocal: unknown;
  readonly occurredOffsetMinutes: unknown;
  readonly occurredTimezone: unknown;
  readonly timezoneDatabaseVersion: unknown;
}

interface OccurrenceFromInstantInput {
  readonly occurredAt: string;
  readonly occurredTimezone: string;
  readonly timezoneDatabaseVersion: string;
}

interface LocalOccurrenceInput {
  readonly occurredLocal: string;
  readonly occurredTimezone: string;
  readonly timezoneDatabaseVersion: string;
}

type LocalOccurrenceResolution =
  | { readonly occurrence: Occurrence; readonly status: "valid" }
  | {
      readonly alternatives: readonly [Occurrence, Occurrence];
      readonly status: "ambiguous";
    }
  | {
      readonly nextValidLocal: string;
      readonly previousValidLocal: string;
      readonly status: "nonexistent";
    };

function occurrenceFromInstant(input: OccurrenceFromInstantInput): Occurrence {
  const instant = parseInstant(input.occurredAt);
  const zoned = instantInZone(instant, input.occurredTimezone);
  validateTzdbVersion(input.timezoneDatabaseVersion);
  return Object.freeze({
    occurredAt: formatInstant(instant),
    occurredLocal: formatLocal(zoned.toPlainDateTime()),
    occurredOffsetMinutes: offsetMinutes(zoned),
    occurredTimezone: zoned.timeZoneId,
    timezoneDatabaseVersion: input.timezoneDatabaseVersion,
  });
}

function validateOccurrenceTuple(
  input: OccurrenceTupleInput,
  context: { readonly now: string },
): Occurrence {
  if (typeof input.occurredAt !== "string") {
    throw new OccurrenceValidationError("OCCURRENCE_INSTANT_INVALID");
  }
  if (typeof input.occurredLocal !== "string" || !localDateTimePattern.test(input.occurredLocal)) {
    throw new OccurrenceValidationError("OCCURRENCE_LOCAL_INVALID");
  }
  if (
    typeof input.occurredOffsetMinutes !== "number" ||
    !Number.isInteger(input.occurredOffsetMinutes) ||
    input.occurredOffsetMinutes < -840 ||
    input.occurredOffsetMinutes > 840
  ) {
    throw new OccurrenceValidationError("OCCURRENCE_OFFSET_INVALID");
  }
  if (typeof input.occurredTimezone !== "string") {
    throw new OccurrenceValidationError("OCCURRENCE_TIMEZONE_INVALID");
  }
  if (typeof input.timezoneDatabaseVersion !== "string") {
    throw new OccurrenceValidationError("OCCURRENCE_TZDB_VERSION_INVALID");
  }
  validateTzdbVersion(input.timezoneDatabaseVersion);

  const instant = parseInstant(input.occurredAt);
  const now = parseInstant(context.now);
  const zoned = instantInZone(instant, input.occurredTimezone);
  let local;
  try {
    local = Temporal.PlainDateTime.from(input.occurredLocal);
  } catch {
    throw new OccurrenceValidationError("OCCURRENCE_LOCAL_INVALID");
  }
  if (
    zoned.timeZoneId !== input.occurredTimezone ||
    !zoned.toPlainDateTime().equals(local) ||
    offsetMinutes(zoned) !== input.occurredOffsetMinutes
  ) {
    throw new OccurrenceValidationError("OCCURRENCE_TUPLE_MISMATCH");
  }
  if (instant.epochNanoseconds - now.epochNanoseconds > fiveMinutesNanoseconds) {
    throw new OccurrenceValidationError("OCCURRENCE_TOO_FAR_IN_FUTURE");
  }

  return Object.freeze({
    occurredAt: input.occurredAt,
    occurredLocal: input.occurredLocal,
    occurredOffsetMinutes: input.occurredOffsetMinutes,
    occurredTimezone: input.occurredTimezone,
    timezoneDatabaseVersion: input.timezoneDatabaseVersion,
  });
}

function resolveLocalOccurrence(input: LocalOccurrenceInput): LocalOccurrenceResolution {
  if (!localDateTimePattern.test(input.occurredLocal)) {
    throw new OccurrenceValidationError("OCCURRENCE_LOCAL_INVALID");
  }
  validateTzdbVersion(input.timezoneDatabaseVersion);
  let local;
  let earlier;
  let later;
  try {
    local = Temporal.PlainDateTime.from(input.occurredLocal);
    earlier = local.toZonedDateTime(input.occurredTimezone, { disambiguation: "earlier" });
    later = local.toZonedDateTime(input.occurredTimezone, { disambiguation: "later" });
  } catch {
    throw new OccurrenceValidationError("OCCURRENCE_TIMEZONE_INVALID");
  }

  const earlierMatches = earlier.toPlainDateTime().equals(local);
  const laterMatches = later.toPlainDateTime().equals(local);
  if (!earlierMatches || !laterMatches) {
    return Object.freeze({
      nextValidLocal: formatLocal(later.toPlainDateTime()),
      previousValidLocal: formatLocal(earlier.toPlainDateTime()),
      status: "nonexistent" as const,
    });
  }

  const earlierOccurrence = occurrenceFromZoned(earlier, input.timezoneDatabaseVersion);
  if (earlier.epochNanoseconds === later.epochNanoseconds) {
    return Object.freeze({ occurrence: earlierOccurrence, status: "valid" as const });
  }
  const laterOccurrence = occurrenceFromZoned(later, input.timezoneDatabaseVersion);
  const alternatives: readonly [Occurrence, Occurrence] = [earlierOccurrence, laterOccurrence];
  return Object.freeze({
    alternatives: Object.freeze(alternatives),
    status: "ambiguous" as const,
  });
}

function resolveRelativeDate(input: {
  readonly captureStartedAt: string;
  readonly relativeDay: unknown;
  readonly reportingTimezone: string;
}): string {
  const instant = parseInstant(input.captureStartedAt);
  const zoned = instantInZone(instant, input.reportingTimezone);
  if (input.relativeDay === "today") return zoned.toPlainDate().toString();
  if (input.relativeDay === "yesterday") {
    return zoned.toPlainDate().subtract({ days: 1 }).toString();
  }
  throw new OccurrenceValidationError("RELATIVE_DATE_INVALID");
}

function occurrenceFromZoned(
  zoned: Temporal.ZonedDateTime,
  timezoneDatabaseVersion: string,
): Occurrence {
  return Object.freeze({
    occurredAt: formatInstant(zoned.toInstant()),
    occurredLocal: formatLocal(zoned.toPlainDateTime()),
    occurredOffsetMinutes: offsetMinutes(zoned),
    occurredTimezone: zoned.timeZoneId,
    timezoneDatabaseVersion,
  });
}

function parseInstant(value: string): Temporal.Instant {
  if (!instantPattern.test(value)) {
    throw new OccurrenceValidationError("OCCURRENCE_INSTANT_INVALID");
  }
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new OccurrenceValidationError("OCCURRENCE_INSTANT_INVALID");
  }
}

function instantInZone(instant: Temporal.Instant, timezone: string): Temporal.ZonedDateTime {
  try {
    return instant.toZonedDateTimeISO(timezone);
  } catch {
    throw new OccurrenceValidationError("OCCURRENCE_TIMEZONE_INVALID");
  }
}

function validateTzdbVersion(value: string): void {
  if (value.trim().length === 0 || value.length > 64) {
    throw new OccurrenceValidationError("OCCURRENCE_TZDB_VERSION_INVALID");
  }
}

function offsetMinutes(value: Temporal.ZonedDateTime): number {
  const minutes = value.offsetNanoseconds / nanosecondsPerMinute;
  if (!Number.isInteger(minutes) || minutes < -840 || minutes > 840) {
    throw new OccurrenceValidationError("OCCURRENCE_OFFSET_INVALID");
  }
  return minutes;
}

function formatInstant(value: Temporal.Instant): string {
  return value.toString({ smallestUnit: "millisecond" }).replace(/\.000Z$/u, "Z");
}

function formatLocal(value: Temporal.PlainDateTime): string {
  return value.toString({ smallestUnit: "millisecond" }).replace(/\.000$/u, "");
}

export {
  OccurrenceValidationError,
  occurrenceFromInstant,
  resolveLocalOccurrence,
  resolveRelativeDate,
  validateOccurrenceTuple,
  type LocalOccurrenceInput,
  type LocalOccurrenceResolution,
  type Occurrence,
  type OccurrenceFromInstantInput,
  type OccurrenceTupleInput,
  type OccurrenceValidationCode,
};
