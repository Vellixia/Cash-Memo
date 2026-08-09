import { Temporal } from "@js-temporal/polyfill";

interface ReportingMonthBounds {
  readonly endExclusive: string;
  readonly startInclusive: string;
}

class ReportingPeriodValidationError extends Error {
  constructor() {
    super("Reporting period validation failed.");
    this.name = "ReportingPeriodValidationError";
  }
}

function reportingMonthBounds(input: {
  readonly month: string;
  readonly reportingTimezone: string;
}): ReportingMonthBounds {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(input.month)) {
    throw new ReportingPeriodValidationError();
  }
  try {
    const month = Temporal.PlainYearMonth.from(input.month);
    const start = month.toPlainDate({ day: 1 }).toZonedDateTime(input.reportingTimezone);
    const end = month
      .add({ months: 1 })
      .toPlainDate({ day: 1 })
      .toZonedDateTime(input.reportingTimezone);
    return Object.freeze({
      endExclusive: formatBoundary(end.toInstant()),
      startInclusive: formatBoundary(start.toInstant()),
    });
  } catch {
    throw new ReportingPeriodValidationError();
  }
}

function formatBoundary(value: Temporal.Instant): string {
  return value.toString({ smallestUnit: "millisecond" }).replace(/\.000Z$/u, "Z");
}

export { ReportingPeriodValidationError, reportingMonthBounds, type ReportingMonthBounds };
