import type { ReactNode } from "react";

export function CurrencyGroup({
  currency,
  children,
  idPrefix = "currency",
}: {
  currency: string;
  children: ReactNode;
  idPrefix?: string;
}) {
  const headingId = `${idPrefix}-${currency}`;
  return (
    <section className="currency-group" aria-labelledby={headingId}>
      <h2 id={headingId}>{currency}</h2>
      {children}
    </section>
  );
}
