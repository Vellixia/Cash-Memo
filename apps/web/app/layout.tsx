import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cash Memo",
  description: "A personal money journal",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">{children}</body>
    </html>
  );
}
