import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { QueryProvider } from "@/lib/query/query-provider";
import { ServiceWorkerRegister } from "./service-worker-register";

export const metadata: Metadata = {
  title: { default: "Cashmemo", template: "%s | Cashmemo" },
  description: "Private manual money journal",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#26735a",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="sr-only focus:not-sr-only" href="#main-content">
          Skip to content
        </a>
        <QueryProvider>
          <main id="main-content">{children}</main>
        </QueryProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
