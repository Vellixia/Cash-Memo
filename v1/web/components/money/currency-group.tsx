import type { ReactNode } from "react";

export function CurrencyGroup({ currency, children }: { currency: string; children: ReactNode }) {
  return <section className="currency-group" aria-labelledby={`currency-${currency}`}><h2 id={`currency-${currency}`}>{currency}</h2>{children}</section>;
}
