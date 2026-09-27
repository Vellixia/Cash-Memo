"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Logo } from "@/components/logo";
import { useConfirmEmail } from "@/lib/queries";

export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmailBody />
    </Suspense>
  );
}

function ConfirmEmailBody() {
  const token = useSearchParams().get("token");
  const confirm = useConfirmEmail();
  const [email, setEmail] = useState<string | null>(null);
  const [asyncError, setAsyncError] = useState<string | null>(null);
  // The token is single-use: guard against React StrictMode's dev double-invoke firing it twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    confirm.mutateAsync(token).then(
      (user) => setEmail(user.email),
      (err) => setAsyncError(err instanceof Error ? err.message : "Something went wrong"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const error = token ? asyncError : "This confirmation link is missing its token.";

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-paper">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={32} />
          <span className="font-serif text-xl tracking-tight">Cash Memo</span>
        </div>
        {email ? (
          <div className="space-y-3">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-income-soft text-income">
              <CheckCircle2 className="size-6" />
            </span>
            <h1 className="font-serif text-2xl">Email confirmed</h1>
            <p className="text-sm text-muted-foreground">Your email is now {email}.</p>
          </div>
        ) : error ? (
          <div className="space-y-3">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-expense-soft text-expense">
              <XCircle className="size-6" />
            </span>
            <h1 className="font-serif text-2xl">Couldn&apos;t confirm</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Confirming your email…</p>
          </div>
        )}
        <Link href="/account" className="mt-6 inline-block text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
          Go to account
        </Link>
      </div>
    </main>
  );
}
