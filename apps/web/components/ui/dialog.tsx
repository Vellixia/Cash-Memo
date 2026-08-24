import type { ReactNode } from "react";

export function Dialog({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dialog" aria-labelledby="dialog-title">
      <h1 id="dialog-title">{title}</h1>
      {children}
    </section>
  );
}
