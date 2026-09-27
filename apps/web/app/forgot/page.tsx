"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, MailCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { useRequestPasswordReset } from "@/lib/queries";

const schema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
});
type Values = z.infer<typeof schema>;

export default function ForgotPage() {
  const request = useRequestPasswordReset();
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    // Always the same outcome, whether or not the address has an account: request() below never rejects on a
    // normal path (the API itself always answers 204), so this only guards a genuine network failure.
    try {
      await request.mutateAsync(values.email.trim());
    } catch {
      // fall through: still show the neutral message, nothing to leak either way
    }
    setSent(true);
  }

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-paper">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo size={32} />
          <span className="font-serif text-xl tracking-tight">Cash Memo</span>
        </div>
        {sent ? (
          <div className="space-y-4 text-center" role="status">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-income-soft text-income">
              <MailCheck className="size-6" />
            </span>
            <h1 className="font-serif text-2xl">Check your email</h1>
            <p className="text-sm text-muted-foreground">If an account exists for that email, we sent a link. It works for 1 hour.</p>
            <Link href="/login" className="inline-block text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-serif text-2xl">Forgot your password?</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Enter your email and we&apos;ll send you a reset link.</p>
            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
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
              <Button type="submit" disabled={request.isPending} className="h-11 w-full rounded-xl text-[0.95rem]">
                {request.isPending && <Loader2 className="animate-spin" />}
                Send reset link
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              <Link href="/login" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
                Back to login
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
