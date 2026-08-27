"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import {
  useConsumePasswordReset,
  useLogin,
  useRegister,
  useRequestPasswordReset,
  useResendVerification,
  useVerifyEmail,
} from "../../generated/api";
import { SESSION_ACCESS_FULL, clearSessionState, getPostLoginPath } from "../../lib/auth/session";
import { credentialsSchema, emailSchema, newPasswordSchema } from "../../lib/validation/auth";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "../../components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field";
import { Input } from "../../components/ui/input";

/** Identical accepted copy for registration and verification resend. Never reveals account state. */
export const ACCOUNT_EMAIL_ACCEPTED_MESSAGE =
  "Check your email. If we can deliver to that address, a verification link is on the way.";

/** Identical accepted copy for every password reset request. */
export const PASSWORD_RESET_ACCEPTED_MESSAGE =
  "Check your email. If we can deliver to that address, reset instructions are on the way.";

const UNCONFIRMED_DELIVERY_MESSAGE =
  "Delivery could not be confirmed from this device. You can request another link shortly.";

const PASSWORD_GUIDANCE = "Use at least 12 characters. Longer passphrases are easier and stronger.";

const FRAGMENT_TOKEN_KEY = "token";

/**
 * Reads the single-use token from a URL fragment only. Query strings are refused so tokens never
 * reach the Next.js server, the reverse proxy, or backend logs.
 */
export function extractFragmentToken(hash: string): string {
  if (hash.startsWith("?")) return "";
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment) return "";
  return new URLSearchParams(fragment).get(FRAGMENT_TOKEN_KEY) ?? "";
}

/** Fragment token stays in page memory only; nothing is written to any browser storage. */
function useFragmentToken(): { token: string; ready: boolean; clearFragment: () => void } {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setToken(extractFragmentToken(window.location.hash));
    setReady(true);
  }, []);

  const clearFragment = useCallback(() => {
    setToken("");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  return { token, ready, clearFragment };
}

function errorText(error: unknown): string {
  const maybe = error as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return maybe.response?.data?.error?.message ?? maybe.message ?? "Request unavailable. Try again.";
}

function AuthPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="w-full max-w-sm ring-foreground/12 [--card-spacing:--spacing(6)]">
      <CardHeader>
        <h1
          data-slot="card-title"
          className="font-heading m-0 text-xl leading-snug font-semibold tracking-tight"
        >
          {title}
        </h1>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive" className="border-destructive/30 bg-destructive/8">
      <AlertDescription className="text-destructive">{children}</AlertDescription>
    </Alert>
  );
}

function AcceptedAlert({ message, unconfirmed }: { message: string; unconfirmed: boolean }) {
  return (
    <Alert role="status" className="border-success/30 bg-success/8">
      <AlertDescription className="text-foreground">
        {message}
        {unconfirmed ? <span className="mt-2 block">{UNCONFIRMED_DELIVERY_MESSAGE}</span> : null}
      </AlertDescription>
    </Alert>
  );
}

function SubmitButton({
  children,
  pending,
  pendingLabel,
}: {
  children: ReactNode;
  pending: boolean;
  pendingLabel: string;
}) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

function EmailField({
  form,
  id,
}: {
  form: UseFormReturn<z.infer<typeof emailSchema>>;
  id: string;
}) {
  const message = form.formState.errors.email?.message;
  return (
    <Field data-invalid={message ? true : undefined}>
      <FieldLabel htmlFor={id}>Email</FieldLabel>
      <Input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="email"
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${id}-error` : undefined}
        {...form.register("email")}
      />
      <FieldError id={`${id}-error`} errors={[form.formState.errors.email]} />
    </Field>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const mutation = useLogin();
  const form = useForm<z.infer<typeof credentialsSchema>>({
    resolver: zodResolver(credentialsSchema),
    mode: "onBlur",
    defaultValues: { email: "", password: "" },
  });

  async function submit(values: z.infer<typeof credentialsSchema>) {
    setError(undefined);
    try {
      const response = await mutation.mutateAsync({ data: values });
      const access = (response.data as { access?: string } | undefined)?.access;
      const destination = getPostLoginPath(access, params.get("returnTo"));
      if (access !== SESSION_ACCESS_FULL) clearSessionState(queryClient);
      router.replace(destination);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <CredentialsForm
      form={form}
      title="Sign in"
      description="Cashmemo stores journal entries, never bank credentials."
      submitLabel="Sign in"
      pendingLabel="Signing in…"
      passwordAutoComplete="current-password"
      error={error}
      pending={mutation.isPending}
      onSubmit={submit}
    />
  );
}

export function RegisterForm() {
  const [acceptedEmail, setAcceptedEmail] = useState<string>();
  const [error, setError] = useState<string>();
  const mutation = useRegister();
  const form = useForm<z.infer<typeof credentialsSchema>>({
    resolver: zodResolver(credentialsSchema),
    mode: "onBlur",
    defaultValues: { email: "", password: "" },
  });

  async function submit(values: z.infer<typeof credentialsSchema>) {
    setError(undefined);
    try {
      await mutation.mutateAsync({ data: values });
      setAcceptedEmail(values.email);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  if (acceptedEmail !== undefined) {
    return (
      <AuthPanel title="Check your email" description="One verification link finishes setup.">
        <div className="flex flex-col gap-4">
          <AcceptedAlert message={ACCOUNT_EMAIL_ACCEPTED_MESSAGE} unconfirmed={false} />
          <ResendVerification email={acceptedEmail} />
        </div>
      </AuthPanel>
    );
  }

  return (
    <CredentialsForm
      form={form}
      title="Create your account"
      description="A private money journal. No bank connection, ever."
      submitLabel="Create account"
      pendingLabel="Creating account…"
      passwordAutoComplete="new-password"
      passwordGuidance={PASSWORD_GUIDANCE}
      error={error}
      pending={mutation.isPending}
      onSubmit={submit}
    />
  );
}

function CredentialsForm({
  form,
  title,
  description,
  submitLabel,
  pendingLabel,
  passwordAutoComplete,
  passwordGuidance,
  error,
  pending,
  onSubmit,
}: {
  form: UseFormReturn<z.infer<typeof credentialsSchema>>;
  title: string;
  description: string;
  submitLabel: string;
  pendingLabel: string;
  passwordAutoComplete: "current-password" | "new-password";
  passwordGuidance?: string;
  error?: string;
  pending: boolean;
  onSubmit: (values: z.infer<typeof credentialsSchema>) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;
  const emailError = errors.email?.message;
  const passwordError = errors.password?.message;

  return (
    <AuthPanel title={title} description={description}>
      <form
        onSubmit={(event) => {
          void handleSubmit(onSubmit)(event);
        }}
        noValidate
      >
        <FieldGroup>
          {error ? <ErrorAlert>{error}</ErrorAlert> : null}
          <Field data-invalid={emailError ? true : undefined}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "email-error" : undefined}
              {...register("email")}
            />
            <FieldError id="email-error" errors={[errors.email]} />
          </Field>
          <Field data-invalid={passwordError ? true : undefined}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete={passwordAutoComplete}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={
                [passwordGuidance ? "password-guidance" : "", passwordError ? "password-error" : ""]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              {...register("password")}
            />
            {passwordGuidance ? (
              <FieldDescription id="password-guidance">{passwordGuidance}</FieldDescription>
            ) : null}
            <FieldError id="password-error" errors={[errors.password]} />
          </Field>
          <SubmitButton pending={pending} pendingLabel={pendingLabel}>
            {submitLabel}
          </SubmitButton>
        </FieldGroup>
      </form>
    </AuthPanel>
  );
}

export function ForgotPasswordForm() {
  const [accepted, setAccepted] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const mutation = useRequestPasswordReset();
  const form = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    mode: "onBlur",
    defaultValues: { email: "" },
  });

  async function submit(values: z.infer<typeof emailSchema>) {
    let delivered = true;
    try {
      await mutation.mutateAsync({ data: values });
    } catch {
      delivered = false;
    }
    setUnconfirmed(!delivered);
    setAccepted(true);
  }

  return (
    <AuthPanel
      title="Reset your password"
      description="We never disclose whether an email has a Cashmemo account."
    >
      <form
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
        noValidate
      >
        <FieldGroup>
          {accepted ? (
            <AcceptedAlert message={PASSWORD_RESET_ACCEPTED_MESSAGE} unconfirmed={unconfirmed} />
          ) : null}
          <EmailField form={form} id="email" />
          <SubmitButton pending={mutation.isPending} pendingLabel="Sending…">
            Send reset link
          </SubmitButton>
        </FieldGroup>
      </form>
    </AuthPanel>
  );
}

function ResendVerification({ email }: { email?: string }) {
  const [accepted, setAccepted] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const mutation = useResendVerification();
  const form = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    mode: "onBlur",
    defaultValues: { email: email ?? "" },
  });

  async function submit(values: z.infer<typeof emailSchema>) {
    let delivered = true;
    try {
      await mutation.mutateAsync({ data: values });
    } catch {
      delivered = false;
    }
    setUnconfirmed(!delivered);
    setAccepted(true);
  }

  return (
    <form
      onSubmit={(event) => {
        void form.handleSubmit(submit)(event);
      }}
      noValidate
    >
      <FieldGroup>
        {accepted ? (
          <AcceptedAlert message={ACCOUNT_EMAIL_ACCEPTED_MESSAGE} unconfirmed={unconfirmed} />
        ) : null}
        {email === undefined ? <EmailField form={form} id="resend-email" /> : null}
        <SubmitButton pending={mutation.isPending} pendingLabel="Sending…">
          Resend email
        </SubmitButton>
      </FieldGroup>
    </form>
  );
}

export function VerifyEmailForm() {
  const { token, ready, clearFragment } = useFragmentToken();
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string>();
  const verify = useVerifyEmail();

  async function submit() {
    setError(undefined);
    try {
      await verify.mutateAsync({ data: { token } });
      setVerified(true);
      clearFragment();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  if (!ready) {
    return (
      <AuthPanel title="Verify email">
        <p role="status">Checking your verification link…</p>
      </AuthPanel>
    );
  }

  if (verified) {
    return (
      <AuthPanel title="Verify email">
        <AcceptedAlert message="Email verified. You can sign in now." unconfirmed={false} />
      </AuthPanel>
    );
  }

  if (!token) {
    return (
      <AuthPanel
        title="Verify email"
        description="Verification links are single use and expire quickly."
      >
        <div className="flex flex-col gap-4">
          <ErrorAlert>
            This verification link is incomplete or expired. Request a new one below.
          </ErrorAlert>
          <ResendVerification />
        </div>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Verify email" description="Confirm this address to finish setup.">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
      >
        <FieldGroup>
          {error ? <ErrorAlert>{error}</ErrorAlert> : null}
          <SubmitButton pending={verify.isPending} pendingLabel="Verifying…">
            Verify email
          </SubmitButton>
        </FieldGroup>
      </form>
    </AuthPanel>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const { token, ready, clearFragment } = useFragmentToken();
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string>();
  const mutation = useConsumePasswordReset();
  const form = useForm<z.infer<typeof newPasswordSchema>>({
    resolver: zodResolver(newPasswordSchema),
    mode: "onBlur",
    defaultValues: { password: "" },
  });

  async function submit(values: z.infer<typeof newPasswordSchema>) {
    setError(undefined);
    try {
      await mutation.mutateAsync({ data: { password: values.password, token } });
      setChanged(true);
      clearFragment();
      router.replace("/login");
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  if (!ready) {
    return (
      <AuthPanel title="Choose a new password">
        <p role="status">Checking your reset link…</p>
      </AuthPanel>
    );
  }

  if (changed) {
    return (
      <AuthPanel title="Choose a new password">
        <AcceptedAlert message="Password changed. Sign in again." unconfirmed={false} />
      </AuthPanel>
    );
  }

  if (!token) {
    return (
      <AuthPanel title="Choose a new password">
        <ErrorAlert>
          This password reset link is invalid or expired. Request a new reset email.
        </ErrorAlert>
      </AuthPanel>
    );
  }

  const passwordError = form.formState.errors.password?.message;

  return (
    <AuthPanel title="Choose a new password">
      <form
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
        noValidate
      >
        <FieldGroup>
          {error ? <ErrorAlert>{error}</ErrorAlert> : null}
          <Field data-invalid={passwordError ? true : undefined}>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={["new-password-guidance", passwordError ? "new-password-error" : ""]
                .filter(Boolean)
                .join(" ")}
              {...form.register("password")}
            />
            <FieldDescription id="new-password-guidance">{PASSWORD_GUIDANCE}</FieldDescription>
            <FieldError id="new-password-error" errors={[form.formState.errors.password]} />
          </Field>
          <SubmitButton pending={mutation.isPending} pendingLabel="Saving…">
            Change password
          </SubmitButton>
        </FieldGroup>
      </form>
    </AuthPanel>
  );
}

export { credentialsSchema };
