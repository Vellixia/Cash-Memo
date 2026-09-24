"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Loader2, Lock, NotebookPen, PieChart } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { useLogin, useSignup } from "@/lib/queries";

const schemas = {
  login: z.object({
    email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
    password: z.string().min(1, "Password is required"),
  }),
  signup: z.object({
    email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
    password: z.string().min(8, "Use at least 8 characters").max(256, "That’s too long"),
  }),
};
type Values = { email: string; password: string };

const COPY = {
  login: { title: "Welcome back", cta: "Log in", alt: "New here?", altCta: "Create an account", altHref: "/signup" },
  signup: { title: "Create your journal", cta: "Create account", alt: "Already have an account?", altCta: "Log in", altHref: "/login" },
};

const PROPS = [
  { icon: NotebookPen, text: "Jot down money in and out in seconds" },
  { icon: PieChart, text: "See where each month went, at a glance" },
  { icon: Lock, text: "Private by default — no bank links, no ads" },
];

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const login = useLogin();
  const signup = useSignup();
  const mutation = mode === "login" ? login : signup;
  const [show, setShow] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const copy = COPY[mode];
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schemas[mode]) });

  async function onSubmit(values: Values) {
    setServerError(null);
    try {
      await mutation.mutateAsync({ email: values.email.trim(), password: values.password });
      // "/" is the landing page while signed out; drop the router cache so it isn't reused for the app.
      router.refresh();
      router.replace("/");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Something went wrong";
      const message = /invalid|credential|unauthori/i.test(raw) ? "Wrong email or password" : raw;
      setServerError(message);
      toast.error(message);
    }
  }

  return (
    // Phones/tablets: brand line + one card. From `lg`: split screen, brand panel on the left.
    <main className="grid min-h-dvh flex-1 content-start lg:grid-cols-[1.1fr_1fr] lg:content-stretch">
      <section className="relative isolate mx-auto flex w-full max-w-sm flex-col gap-4 overflow-hidden px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-5 sm:pt-[calc(3rem+env(safe-area-inset-top))] lg:mx-0 lg:max-w-none lg:justify-between lg:gap-0 lg:border-r lg:border-border lg:bg-[linear-gradient(160deg,var(--card)_0%,var(--card)_45%,var(--income-soft)_130%)] lg:px-12 lg:py-12 xl:px-16">
        <div className="flex items-center gap-2.5">
          <Logo size={32} />
          <span className="font-serif text-xl tracking-tight">Cash Memo</span>
        </div>
        <div>
          <h1 className="max-w-md font-serif text-[1.75rem] leading-[1.05] tracking-tight sm:text-4xl lg:text-6xl xl:text-7xl">
            Your private <em className="text-income">money</em> journal
          </h1>
          <ul className="mt-8 hidden space-y-3.5 lg:block">
            {PROPS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-muted-foreground">
                <span className="flex size-8 items-center justify-center rounded-xl bg-income-soft text-income">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-xs text-muted-foreground lg:block">Calm bookkeeping for real life.</p>
        <LedgerLines />
      </section>

      <section className="flex items-start justify-center px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:items-center lg:px-10 lg:pb-12">
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-paper sm:p-6 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <h2 className="font-serif text-2xl">{copy.title}</h2>
          <form method="post" onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="h-11 rounded-xl bg-card px-3.5"
                aria-invalid={!!errors.email}
                {...register("email")}
              />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <div className="relative">
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder={mode === "signup" ? "At least 8 characters" : undefined}
                  className="h-11 rounded-xl bg-card pr-11 pl-3.5"
                  aria-invalid={!!errors.password}
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <FieldError errors={[errors.password]} />
            </Field>
            {serverError && (
              <p role="alert" className="rounded-xl bg-expense-soft px-3.5 py-2.5 text-sm text-expense">
                {serverError}
              </p>
            )}
            <Button type="submit" disabled={mutation.isPending} className="h-11 w-full rounded-xl text-[0.95rem]">
              {mutation.isPending && <Loader2 className="animate-spin" />}
              {copy.cta}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {copy.alt}{" "}
            <Link href={copy.altHref} className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              {copy.altCta}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

/** Faint ruled lines, like a ledger page. */
function LedgerLines() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 hidden opacity-40 lg:block"
      style={{
        backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 39px, var(--border) 39px 40px)",
        maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
      }}
    />
  );
}
