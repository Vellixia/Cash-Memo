export interface ExactDecimalParts {
  sign: "" | "+" | "-";
  whole: string;
  fraction: string;
  groupedWhole: string;
  canonical: string;
}

const CANONICAL_DECIMAL = /^([+-]?)(0|[1-9]\d*)(?:\.(\d+))?$/;

export function splitExactDecimal(value: string): ExactDecimalParts | null {
  if (typeof value !== "string") return null;
  const match = CANONICAL_DECIMAL.exec(value);
  if (!match) return null;
  const sign = match[1] as "" | "+" | "-";
  const whole = match[2];
  const fraction = (match[3] as string | undefined) ?? "";
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return {
    sign,
    whole,
    fraction,
    groupedWhole,
    canonical: `${sign}${whole}${fraction ? `.${fraction}` : ""}`,
  };
}

export function formatExactDecimal(value: string): string {
  const parts = splitExactDecimal(value);
  if (!parts) return value;
  return `${parts.sign}${parts.groupedWhole}${parts.fraction ? `.${parts.fraction}` : ""}`;
}

/** Convert a server-derived decimal percentage only for graphical width. */
export function boundedPercentage(value: string): number {
  const parts = splitExactDecimal(value);
  if (!parts || parts.sign === "-") return 0;
  const whole = parts.whole;
  if (whole.length > 3 || (whole.length === 3 && whole > "100")) return 100;
  if (whole === "100") return 100;
  const fraction = parts.fraction.padEnd(2, "0").slice(0, 2);
  return Number(`${whole}.${fraction}`);
}
