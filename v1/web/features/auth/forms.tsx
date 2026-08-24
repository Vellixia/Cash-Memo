"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import {
  useConsumePasswordReset,
  useLogin,
  useRegister,
  useRequestPasswordReset,
  useResendVerification,
  useVerifyEmail,
} from "../../generated/api";
import { getSafeReturnPath } from "../../lib/auth/session";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";

const credentialsSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter valid email")),
  password: z.string().min(12, "Use at least 12 characters"),
});
const emailSchema = z.object({ email: z.string().trim().pipe(z.email("Enter valid email")) });
const resetSchema = z.object({ password: z.string().min(12, "Use at least 12 characters") });
const tokenSchema = z.object({ token: z.string().trim().min(1, "Verification link is missing") });

type FormStatus = { kind: "error" | "success"; text: string } | undefined;

function errorText(error: unknown): string {
  const maybe = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return maybe.response?.data?.error?.message ?? maybe.message ?? "Request unavailable. Try again.";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<FormStatus>();
  const mutation = useLogin();
  const form = useForm<z.infer<typeof credentialsSchema>>({
    resolver: zodResolver(credentialsSchema), mode: "onChange", defaultValues: { email: "", password: "" },
  });

  async function submit(values: z.infer<typeof credentialsSchema>) {
    setStatus(undefined);
    try {
      await mutation.mutateAsync({ data: values });
      router.replace(getSafeReturnPath(params.get("returnTo")));
    } catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }

  return <CredentialsForm form={form} title="Sign in" submitLabel="Sign in" status={status} loading={mutation.isPending} onSubmit={submit} />;
}

export function RegisterForm() {
  const router = useRouter();
  const [status, setStatus] = useState<FormStatus>();
  const mutation = useRegister();
  const form = useForm<z.infer<typeof credentialsSchema>>({
    resolver: zodResolver(credentialsSchema), mode: "onChange", defaultValues: { email: "", password: "" },
  });
  async function submit(values: z.infer<typeof credentialsSchema>) {
    setStatus(undefined);
    try { await mutation.mutateAsync({ data: values }); router.replace(`/verify-email?email=${encodeURIComponent(values.email)}`); }
    catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }
  return <CredentialsForm form={form} title="Create private journal" submitLabel="Create account" status={status} loading={mutation.isPending} onSubmit={submit} />;
}

function CredentialsForm({ form, title, submitLabel, status, loading, onSubmit }: {
  form: ReturnType<typeof useForm<z.infer<typeof credentialsSchema>>>;
  title: string; submitLabel: string; status: FormStatus; loading: boolean;
  onSubmit: (values: z.infer<typeof credentialsSchema>) => Promise<void>;
}) {
  const { register, handleSubmit, formState: { errors, isValid } } = form;
  return <form className="auth-form" onSubmit={(event) => { void handleSubmit(onSubmit)(event); }} noValidate>
    <h1>{title}</h1>
    <p className="muted">Cashmemo stores journal entries, never bank credentials.</p>
    <FormField label="Email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" autoComplete="email" {...register("email")} /></FormField>
    <FormField label="Password" htmlFor="password" error={errors.password?.message}><Input id="password" type="password" autoComplete={title === "Sign in" ? "current-password" : "new-password"} {...register("password")} /></FormField>
    {status ? <p role="alert" className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}
    <Button type="submit" disabled={!isValid || loading}>{loading ? "Working…" : submitLabel}</Button>
  </form>;
}

export function ForgotPasswordForm() {
  const [status, setStatus] = useState<FormStatus>();
  const mutation = useRequestPasswordReset();
  const form = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema), mode: "onChange", defaultValues: { email: "" } });
  async function submit(values: z.infer<typeof emailSchema>) {
    setStatus(undefined);
    try { await mutation.mutateAsync({ data: values }); setStatus({ kind: "success", text: "If an account matches, reset instructions are on the way." }); }
    catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }
  return <form className="auth-form" onSubmit={(event) => { void form.handleSubmit(submit)(event); }} noValidate><h1>Reset password</h1><p className="muted">We never disclose whether an email has an account.</p><FormField label="Email" htmlFor="email" error={form.formState.errors.email?.message}><Input id="email" type="email" autoComplete="email" {...form.register("email")} /></FormField>{status ? <p role="status" className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}<Button type="submit" disabled={!form.formState.isValid || mutation.isPending}>Send reset link</Button></form>;
}

export function VerifyEmailForm() {
  const params = useSearchParams();
  const [status, setStatus] = useState<FormStatus>();
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const form = useForm<z.infer<typeof tokenSchema>>({ resolver: zodResolver(tokenSchema), mode: "onChange", defaultValues: { token: params.get("token") ?? "" } });
  async function submit(values: z.infer<typeof tokenSchema>) { try { await verify.mutateAsync({ data: values }); setStatus({ kind: "success", text: "Email verified. You can sign in." }); } catch (error) { setStatus({ kind: "error", text: errorText(error) }); } }
  async function resendLink() { const email = params.get("email") ?? ""; if (!emailSchema.safeParse({ email }).success) { setStatus({ kind: "error", text: "Enter email again to resend." }); return; } try { await resend.mutateAsync({ data: { email } }); setStatus({ kind: "success", text: "If an account matches, a new link is on the way." }); } catch (error) { setStatus({ kind: "error", text: errorText(error) }); } }
  return <form className="auth-form" onSubmit={(event) => { void form.handleSubmit(submit)(event); }} noValidate><h1>Verify email</h1><p className="muted">Use single-use link from your email.</p><FormField label="Verification token" htmlFor="token" error={form.formState.errors.token?.message}><Input id="token" type="text" autoComplete="off" {...form.register("token")} /></FormField>{status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}<Button type="submit" disabled={!form.formState.isValid || verify.isPending}>Verify email</Button><Button type="button" variant="quiet" onClick={() => { void resendLink(); }} disabled={resend.isPending}>Resend email</Button></form>;
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const mutation = useConsumePasswordReset();
  const [status, setStatus] = useState<FormStatus>();
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), mode: "onChange", defaultValues: { password: "" } });
  async function submit(values: z.infer<typeof resetSchema>) { const token = params.get("token") ?? ""; if (!token) { setStatus({ kind: "error", text: "Reset link is invalid or expired." }); return; } try { await mutation.mutateAsync({ data: { ...values, token } }); setStatus({ kind: "success", text: "Password changed. Sign in again." }); router.replace("/login"); } catch (error) { setStatus({ kind: "error", text: errorText(error) }); } }
  return <form className="auth-form" onSubmit={(event) => { void form.handleSubmit(submit)(event); }} noValidate><h1>Choose new password</h1><FormField label="New password" htmlFor="password" error={form.formState.errors.password?.message}><Input id="password" type="password" autoComplete="new-password" {...form.register("password")} /></FormField>{status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}<Button type="submit" disabled={!form.formState.isValid || mutation.isPending}>Change password</Button></form>;
}
