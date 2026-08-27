import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "../lib/query/provider";
import { ServiceWorkerRegistration } from "../components/sw-register";
import "./globals.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Cashmemo",
  description: "Private money journal",
  applicationName: "Cashmemo",
  manifest: "/manifest.webmanifest",
};

/** `viewport-fit=cover` is required for the safe-area insets the mobile shell and auth actions use. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          {children}
          <Toaster />
        </QueryProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
