function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatDecimal(value: string): string {
  const trimmed = value.trim();
  const match = /^-?\d+(?:\.\d+)?$/.exec(trimmed);
  if (!match) return value;
  const decimalIndex = trimmed.indexOf(".");
  const whole = decimalIndex === -1 ? trimmed : trimmed.slice(0, decimalIndex);
  const fraction = decimalIndex === -1 ? "" : trimmed.slice(decimalIndex);
  return `${groupDigits(whole)}${fraction}`;
}

export function Amount({ value, currency }: { value: string; currency: string }) {
  return <span className="money-amount">{currency} {formatDecimal(value)}</span>;
}
