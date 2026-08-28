import cashmemoTimezones from "./cashmemo-timezones.json";

const SUPPORTED_CASHMEMO_IANA_TIMEZONES = new Set<string>(cashmemoTimezones);

export type CashmemoTimezone = string & { readonly __cashmemoTimezone: unique symbol };

export function parseCashmemoTimezone(value: string | null | undefined): CashmemoTimezone | undefined {
  if (!value || !SUPPORTED_CASHMEMO_IANA_TIMEZONES.has(value)) return undefined;
  return value as CashmemoTimezone;
}
