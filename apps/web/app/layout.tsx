import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Atkinson_Hyperlegible, Fraunces, Geist, Geist_Mono, Quicksand } from "next/font/google";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"] });
// Non-default font pairs ("modern" / "readable" / "rounded" / "mono"): not needed until chosen in
// Appearance (or previewed there), so skip preload.
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", preload: false });
const atkinson = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-atkinson", preload: false });
const quicksand = Quicksand({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-quicksand", preload: false });

/** Sets data-accent/data-font/data-size from localStorage before paint, so there's no flash. */
const APPEARANCE_SCRIPT = `(function(){try{var d=document.documentElement,m={accent:"cm-accent",font:"cm-font",size:"cm-size"};for(var k in m){var v=localStorage.getItem(m[k]);if(v)d.setAttribute("data-"+k,v)}}catch(e){}})();`;

export const metadata: Metadata = {
  metadataBase: new URL("https://cashmemo.andresholivin.dev"),
  title: "Cash Memo",
  description: "Your private money journal",
  applicationName: "Cash Memo",
  appleWebApp: { capable: true, title: "Cash Memo", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Draw under the notch / home indicator; the app shell pads with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#151412" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn("h-full font-sans", geist.variable, fraunces.variable, geistMono.variable, atkinson.variable, quicksand.variable)}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
