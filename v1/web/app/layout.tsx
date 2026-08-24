import type { Metadata } from "next";
import type { ReactNode } from "react";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><QueryProvider>{children}</QueryProvider><ServiceWorkerRegistration /></body></html>;
}
