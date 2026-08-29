import type { ReactNode } from "react";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-page">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full max-w-sm flex-col items-stretch gap-6"
      >
        <p className="font-heading m-0 text-center text-lg font-bold tracking-tight text-primary">
          Cashmemo
        </p>
        {children}
      </main>
    </div>
  );
}
