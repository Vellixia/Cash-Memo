import { formatExactDecimal } from "./exact-decimal";

export function formatDecimal(value: string): string {
  return formatExactDecimal(value);
}

export interface MoneyAmountProps {
  value: string;
  currency: string;
  direction?: "income" | "expense";
  context?: string;
}

export function MoneyAmount({ value, currency, direction, context }: MoneyAmountProps) {
  const formatted = formatExactDecimal(value);
  const meaning = direction ? `${direction === "income" ? "Income" : "Expense"} ` : "";
  const label = `${meaning}${currency} ${formatted}${context ? `, ${context}` : ""}`;
  return (
    <span className="money-amount" data-direction={direction} aria-label={label}>
      {currency} {formatted}
    </span>
  );
}

export function Amount(props: MoneyAmountProps) {
  return <MoneyAmount {...props} />;
}
