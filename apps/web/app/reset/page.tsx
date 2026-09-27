"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { useCompletePasswordReset } from "@/lib/queries";

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(256, "That’s too long"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don’t match", path: ["confirm"] });
type Values = z.infer<typeof schema>;

export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const complete = useCompletePasswordReset();
  const [invalid, setInvalid] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    if (!token) return setInvalid(true);
    try {
      await complete.mutateAsync({ token, password: values.password });
      toast.success("Password changed. Log in with your new password.");
      router.replace("/login");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      if (/invalid|expired/i.test(message)) setInvalid(true);
      else toast.error(message);
    }
  }

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-paper">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo size={32} />
          <span className="font-serif text-xl tracking-tight">Cash Memo</span>
        </div>
        {invalid || !token ? (
          <div className="space-y-4 text-center">
            <h1 className="font-serif text-2xl">Link expired</h1>
            <p className="text-sm text-muted-foreground">That reset link is invalid or expired. Ask for a new one.</p>
            <Link
              href="/forgot"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Request a new link
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-serif text-2xl">Choose a new password</h1>
            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
              <Field data-invalid={!!errors.password}>
                <FieldLabel htmlFor="password">New password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  className="h-11 rounded-xl bg-card px-3.5"
                  aria-invalid={!!errors.password}
                  {...register("password")}
                />
                <FieldError errors={[errors.password]} />
              </Field>
              <Field data-invalid={!!errors.confirm}>
                <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  className="h-11 rounded-xl bg-card px-3.5"
                  aria-invalid={!!errors.confirm}
                  {...register("confirm")}
                />
                <FieldError errors={[errors.confirm]} />
              </Field>
              <Button type="submit" disabled={complete.isPending} className="h-11 w-full rounded-xl text-[0.95rem]">
                {complete.isPending && <Loader2 className="animate-spin" />}
                Set new password
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
