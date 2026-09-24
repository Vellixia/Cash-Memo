import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileDown,
  Globe,
  ListFilter,
  MonitorSmartphone,
  Moon,
  PieChart,
  Repeat,
  ShieldCheck,
  Sparkles,
  Target,
  WifiOff,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { ProductMock } from "@/components/landing/product-mock";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const title = "Cash Memo — Your private money journal";
const description =
  "Jot down income and expenses in any currency, see each month at a glance, and keep it to yourself. No bank connections, no ads, no selling your data.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "https://cashmemo.andresholivin.dev/" },
  openGraph: { type: "website", url: "https://cashmemo.andresholivin.dev/", siteName: "Cash Memo", title, description, locale: "en_US" },
  twitter: { card: "summary_large_image", title, description },
};

const wrap = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";
const focus = "rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const primaryCta = cn(buttonVariants(), "h-11 gap-2 rounded-xl px-5 text-[0.95rem]");
const secondaryCta = cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl px-5 text-[0.95rem]");

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#privacy", label: "Privacy" },
  { href: "#faq", label: "FAQ" },
];

const STEPS = [
  {
    title: "Jot it down",
    text: "Tap +, type the amount, pick a category. A memo takes a few seconds, in whatever currency you actually paid in.",
  },
  {
    title: "See the month",
    text: "Your net, income against expense, and where the spending went — with every memo grouped by day underneath.",
  },
  {
    title: "Stay private",
    text: "There is nothing to link and nothing syncing with your bank. The journal holds only what you choose to write.",
  },
];

const FEATURES = [
  {
    icon: Globe,
    title: "Any currency, written natively",
    text: "Dollars, euros, yen, rupiah. Each amount is written the way its currency is — ¥1,200, not ¥1,200.00 — and totals stay per currency, never silently converted.",
  },
  {
    icon: PieChart,
    title: "Emoji categories and a spending donut",
    text: "Name a category, give it an emoji — 🍜 Food, 🚌 Transport — and see at a glance which ones took the most this month.",
  },
  {
    icon: ListFilter,
    title: "A day-by-day ledger",
    text: "Every memo lands under its day, newest first. Filter down to income or expenses when you want a closer look.",
  },
  {
    icon: MonitorSmartphone,
    title: "Works everywhere, installs like an app",
    text: "Made for phone, tablet and desktop alike. Add it to your home screen or dock and it opens in its own window.",
  },
  {
    icon: WifiOff,
    title: "Readable offline",
    text: "Pages you have opened stay readable without a connection — on a plane, in a basement café. New memos wait until you are back online.",
  },
  {
    icon: Moon,
    title: "Easy on the eyes, day or night",
    text: "Warm paper by day, soft charcoal by night. It follows your system setting, or you can pick one yourself.",
  },
];

const PROMISES = [
  { title: "No bank connections.", text: "We never ask for your bank login and never pull transactions. You decide what goes in." },
  { title: "No ads.", text: "Your spending is not a marketing signal and is never used to target you." },
  { title: "No selling, no sharing.", text: "Your data is not sold, rented or handed to data brokers." },
  { title: "Only you can read it.", text: "Memos belong to your account, behind a secure, HTTP-only session cookie." },
  { title: "Nothing left behind.", text: "Logging out clears the offline copy the app keeps on your device." },
  { title: "Yours to take with you.", text: "CSV export is on the way, so you can leave any time with everything you wrote." },
];

const SOON = [
  { icon: Target, title: "Budgets", text: "A monthly limit per category" },
  { icon: Repeat, title: "Recurring memos", text: "Rent and subscriptions, entered once" },
  { icon: FileDown, title: "CSV export", text: "Everything you wrote, in a spreadsheet" },
  { icon: Sparkles, title: "Smart suggestions", text: "Categories picked up from your own history" },
];

const FAQ = [
  {
    q: "Is it free?",
    a: "Yes. Cash Memo is free to use — sign up with an email and a password, no card and no trial clock.",
  },
  {
    q: "Do you connect to my bank?",
    a: "No, and that is on purpose. Cash Memo never asks for bank credentials and never imports transactions. You write down what matters to you, which also tends to make you notice where the money goes.",
  },
  {
    q: "Which currencies can I use?",
    a: "Any ISO currency code — USD, EUR, GBP, JPY, IDR and the rest. Each memo keeps its own currency and is shown in that currency's usual format. Monthly totals are kept per currency, so nothing is converted behind your back.",
  },
  {
    q: "Can I use it on my phone?",
    a: "Yes. It works in any modern browser on phone, tablet and desktop. To install it, use “Add to Home Screen” from the share menu on iPhone or iPad, or “Install app” in Chrome and Edge on Android and desktop.",
  },
  {
    q: "Where is my data stored?",
    a: "On the Cash Memo server, in a database tied to your account, and nowhere else. If you install the app, pages you have viewed are also cached on your device so you can read them offline; logging out clears that cache.",
  },
  {
    q: "Can I export my data?",
    a: "Not yet — CSV export is next on the list. When it lands you will be able to download every memo, in every currency, whenever you like.",
  },
];

function SectionHead({ id, eyebrow, title, lead }: { id: string; eyebrow: string; title: string; lead?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-medium text-income">{eyebrow}</p>
      <h2 id={id} className="mt-2 font-serif text-3xl leading-tight tracking-tight sm:text-4xl">
        {title}
      </h2>
      {lead && <p className="mt-3 text-base text-muted-foreground sm:text-lg">{lead}</p>}
    </div>
  );
}

export default function WelcomePage() {
  return (
    <div id="landing" className="flex flex-1 flex-col overflow-x-clip">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-card px-3 py-2 text-sm shadow-paper focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <nav aria-label="Main" className={cn(wrap, "flex h-14 items-center gap-2")}>
          <Link href="/" className={cn(focus, "mr-auto flex items-center gap-2")}>
            <Logo size={26} />
            <span className="font-serif text-lg tracking-tight">Cash Memo</span>
          </Link>
          <ul className="mr-3 hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} className={cn(focus, "px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground")}>
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
          <Link href="/login" className={cn(focus, "px-2.5 py-1.5 text-sm font-medium hover:text-income")}>
            Log in
          </Link>
          <Link href="/signup" className={cn(buttonVariants(), "h-9 rounded-xl px-3.5")}>
            Get started
          </Link>
        </nav>
      </header>

      <main id="main" className="flex-1">
        {/* Hero */}
        <section aria-labelledby="hero-title" className="relative isolate">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 opacity-50"
            style={{
              backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 39px, var(--border) 39px 40px)",
              maskImage: "radial-gradient(ellipse 70% 60% at 50% 30%, black, transparent)",
            }}
          />
          <div
            aria-hidden
            className="absolute top-1/3 left-1/2 -z-10 size-[42rem] -translate-x-1/2 rounded-full bg-income-soft opacity-70 blur-3xl lg:left-3/4"
          />
          <div className={cn(wrap, "grid items-center gap-14 pt-12 pb-16 sm:pt-20 lg:grid-cols-[1fr_1.1fr] lg:gap-8 lg:pt-24 lg:pb-28")}>
            <div className="text-center lg:text-left">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-paper">
                <ShieldCheck className="size-3.5 text-income" /> No bank links. No ads.
              </p>
              <h1
                id="hero-title"
                className="mt-5 font-serif text-[2.6rem] leading-[1.02] tracking-tight text-balance sm:text-6xl lg:text-7xl"
              >
                Your private <em className="text-income">money</em> journal
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-muted-foreground sm:text-xl lg:mx-0">
                Jot down what comes in and what goes out, in any currency, and see where the month went — without handing
                your bank login to anyone.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
                <Link href="/signup" className={primaryCta}>
                  Get started free <ArrowRight className="size-4" />
                </Link>
                <Link href="/login" className={secondaryCta}>
                  Log in
                </Link>
              </div>
              <p className="mt-5 text-sm text-muted-foreground">Free · Phone, tablet and desktop · Works offline</p>
            </div>
            <ProductMock />
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how" className="border-t border-border py-20 sm:py-24">
          <div className={wrap}>
            <SectionHead id="how" eyebrow="How it works" title="Three habits, no setup" />
            <ol className="mt-10 grid gap-4 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-3xl border border-border bg-card p-6 shadow-paper">
                  <span className="num text-3xl text-income">0{i + 1}</span>
                  <h3 className="mt-3 text-lg font-medium">{s.title}</h3>
                  <p className="mt-1.5 text-muted-foreground">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" aria-labelledby="features-title" className="py-20 sm:py-24">
          <div className={wrap}>
            <SectionHead
              id="features-title"
              eyebrow="Features"
              title="Everything a money journal needs, and nothing it doesn’t"
              lead="Small on purpose. Every screen is there to help you write things down and read them back."
            />
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-3xl border border-border bg-card p-6 shadow-paper">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-income-soft text-income">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 font-medium">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Privacy */}
        <section id="privacy" aria-labelledby="privacy-title" className="border-y border-border bg-card py-20 sm:py-24">
          <div className={cn(wrap, "grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-16")}>
            <div>
              <SectionHead
                id="privacy-title"
                eyebrow="Privacy"
                title="Private by default, not by setting"
                lead="Cash Memo is a journal, not a data business. It works because you write things down — not because it watches your accounts."
              />
              <ShieldCheck className="mt-10 hidden size-24 text-income opacity-15 lg:block" aria-hidden strokeWidth={1.25} />
            </div>
            <ul className="divide-y divide-border rounded-3xl border border-border bg-background">
              {PROMISES.map((p) => (
                <li key={p.title} className="flex gap-3.5 p-5">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-income-soft text-income">
                    <Check className="size-3.5" aria-hidden strokeWidth={2.5} />
                  </span>
                  <p className="text-muted-foreground">
                    <strong className="font-medium text-foreground">{p.title}</strong> {p.text}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Coming soon */}
        <section aria-labelledby="soon-title" className="py-16 sm:py-20">
          <div className={wrap}>
            <div className="rounded-3xl border border-dashed border-input p-6 sm:p-8">
              <h2 id="soon-title" className="font-serif text-2xl tracking-tight">
                On the way
              </h2>
              <p className="mt-1 text-muted-foreground">What we are building next, in roughly this order.</p>
              <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {SOON.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-3">
                    <Icon className="mt-0.5 size-5 shrink-0 text-income" aria-hidden />
                    <div>
                      <h3 className="font-medium">{title}</h3>
                      <p className="text-sm text-muted-foreground">{text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className="pb-20 sm:pb-24">
          <div className={cn(wrap, "grid gap-8 lg:grid-cols-[1fr_1.6fr] lg:gap-16")}>
            <SectionHead id="faq-title" eyebrow="FAQ" title="Questions, answered plainly" />
            <div className="border-t border-border">
              {FAQ.map((f) => (
                <details key={f.q} className="group border-b border-border">
                  <summary
                    className={cn(
                      focus,
                      "flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-lg font-medium [&::-webkit-details-marker]:hidden",
                    )}
                  >
                    {f.q}
                    <ChevronDown
                      className="size-5 shrink-0 text-muted-foreground group-open:rotate-180 motion-safe:transition-transform"
                      aria-hidden
                    />
                  </summary>
                  <p className="-mt-1 pr-8 pb-5 text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section aria-labelledby="cta-title" className="pb-20 sm:pb-24">
          <div className={wrap}>
            <div className="relative isolate overflow-hidden rounded-3xl border border-border bg-income-soft px-6 py-14 text-center sm:px-12">
              <div
                aria-hidden
                className="absolute inset-0 -z-10 opacity-60"
                style={{
                  backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 31px, var(--border) 31px 32px)",
                  maskImage: "linear-gradient(to bottom, transparent, black 40%, black 60%, transparent)",
                }}
              />
              <h2 id="cta-title" className="font-serif text-3xl tracking-tight text-balance sm:text-5xl">
                Start this month’s page
              </h2>
              <p className="mx-auto mt-3 max-w-md text-muted-foreground">
                Your first memo is a few seconds away. Free, private, and yours.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Link href="/signup" className={primaryCta}>
                  Get started free <ArrowRight className="size-4" />
                </Link>
                <Link href="/login" className={secondaryCta}>
                  I already have an account
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border pb-[env(safe-area-inset-bottom)]">
        <div className={cn(wrap, "flex flex-col gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center")}>
          <div className="flex items-center gap-2">
            <Logo size={20} />
            <span>© 2026 Cash Memo</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={cn(focus, "hover:text-foreground")}>
                {n.label}
              </a>
            ))}
            <Link href="/login" className={cn(focus, "hover:text-foreground")}>
              Log in
            </Link>
            <Link href="/signup" className={cn(focus, "hover:text-foreground")}>
              Sign up
            </Link>
          </nav>
          <p className="sm:border-l sm:border-border sm:pl-5">Built with care.</p>
        </div>
      </footer>
    </div>
  );
}
