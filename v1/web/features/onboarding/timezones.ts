export function getTimezoneOptions(): string[] {
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let supported: string[];
  try {
    supported =
      typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch {
    supported = [];
  }
  return Array.from(
    new Set(
      [browserTimezone, ...supported, "UTC"].filter((value): value is string => Boolean(value)),
    ),
  );
}
