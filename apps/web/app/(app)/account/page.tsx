"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronRight, Download, FileUp, Loader2, LogOut, Share, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ThemeSelect } from "@/components/theme-select";
import { AppearanceSettings } from "@/components/appearance-settings";
import { useLogoutAndLeave } from "@/components/app-shell";
import { card } from "@/components/summary";
import { CurrencyPicker } from "@/components/currency-picker";
import { useInstall } from "@/lib/install";
import { currencyName } from "@/lib/money";
import type { ExportResult } from "@/lib/api";
import {
  useChangeEmail,
  useChangePassword,
  useDeleteAccount,
  useJob,
  useMe,
  useStartExport,
  useUpdateMe,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function AccountPage() {
  const { data: me } = useMe();
  const logout = useLogoutAndLeave();
  const updateMe = useUpdateMe();
  const { canInstall, iosHint, install } = useInstall();

  async function setDefaultCurrency(code: string) {
    if (code === me?.default_currency) return;
    try {
      await updateMe.mutateAsync({ default_currency: code });
      toast.success(`New memos will start in ${code}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the default currency");
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Account</h1>

      <section className={cn(card, "flex items-center gap-4 p-5")} aria-label="Profile">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-income-soft font-serif text-xl text-income ring-1 ring-border">
          {me?.email?.[0]?.toUpperCase() ?? "·"}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Signed in as</p>
          {me ? (
            <p className="truncate font-medium" data-testid="account-email">
              {me.email}
            </p>
          ) : (
            <Skeleton className="mt-1 h-4 w-44" />
          )}
        </div>
      </section>

      <section className={cn(card, "flex items-center gap-4 p-5")} aria-labelledby="default-currency">
        <div className="min-w-0 flex-1">
          <h2 id="default-currency" className="text-sm font-medium">
            Default currency
          </h2>
          <p className="text-sm text-muted-foreground">New memos start in it.</p>
        </div>
        {me ? (
          <CurrencyPicker
            value={me.default_currency}
            defaultCurrency={me.default_currency}
            onChange={setDefaultCurrency}
            triggerLabel={`Default currency ${me.default_currency}, change`}
            triggerClassName="flex min-h-11 max-w-[55%] shrink-0 items-center gap-2 rounded-xl border border-input bg-card px-3 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 md:min-h-10"
          >
            {updateMe.isPending ? <Loader2 className="size-4 animate-spin" /> : <span className="font-semibold tracking-wider">{me.default_currency}</span>}
            <span className="truncate text-muted-foreground" data-testid="default-currency-name">
              {currencyName(me.default_currency)}
            </span>
          </CurrencyPicker>
        ) : (
          <Skeleton className="h-10 w-36 rounded-xl" />
        )}
      </section>

      <section className={cn(card, "space-y-3 p-5")} aria-labelledby="appearance">
        <h2 id="appearance" className="text-sm font-medium">
          Appearance
        </h2>
        <ThemeSelect />
        <AppearanceSettings />
      </section>

      <PasswordSection />
      <EmailSection email={me?.email} />
      <DataSection />

      <Link
        href="/categories"
        className={cn(card, "flex items-center gap-3 p-5 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40")}
      >
        <Tags className="size-5 text-muted-foreground" />
        <span className="flex-1 font-medium">Manage categories</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>

      {(canInstall || iosHint) && (
        <section className={cn(card, "flex items-center gap-4 p-5")} aria-labelledby="install-app">
          <div className="min-w-0 flex-1">
            <h2 id="install-app" className="text-sm font-medium">
              App
            </h2>
            {canInstall ? (
              <p className="text-sm text-muted-foreground">Open Cash Memo from your home screen or dock, even offline.</p>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="ios-install-hint">
                On iPhone: Share <Share className="inline size-3.5 align-[-0.1em]" aria-label="(the share icon)" /> → Add to Home Screen
              </p>
            )}
          </div>
          {canInstall && (
            <Button variant="outline" className="h-11 shrink-0 rounded-xl md:h-10" onClick={install}>
              <Download /> Install app
            </Button>
          )}
        </section>
      )}

      <Button
        variant="outline"
        className="h-11 w-full rounded-2xl border-expense/30 bg-card text-expense hover:bg-expense-soft hover:text-expense"
        onClick={logout.run}
        disabled={logout.pending}
      >
        {logout.pending ? <Loader2 className="animate-spin" /> : <LogOut />}
        Log out
      </Button>

      <DeleteAccountSection />
    </div>
  );
}

const passwordSchema = z.object({
  current: z.string().min(1, "Enter your current password"),
  next: z.string().min(8, "Use at least 8 characters").max(256, "That’s too long"),
});
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordSection() {
  const change = useChangePassword();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  async function onSubmit(values: PasswordValues) {
    setServerError(null);
    try {
      await change.mutateAsync({ current: values.current, next: values.next });
      toast.success("Password changed. Other devices were signed out.");
      reset({ current: "", next: "" });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not change password");
    }
  }

  return (
    <section className={cn(card, "space-y-3 p-5")} aria-labelledby="password">
      <h2 id="password" className="text-sm font-medium">
        Password
      </h2>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <Field data-invalid={!!errors.current}>
          <FieldLabel htmlFor="current-password">Current password</FieldLabel>
          <Input id="current-password" type="password" autoComplete="current-password" className="h-11 rounded-xl bg-card px-3.5" {...register("current")} />
          <FieldError errors={[errors.current]} />
        </Field>
        <Field data-invalid={!!errors.next}>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            className="h-11 rounded-xl bg-card px-3.5"
            {...register("next")}
          />
          <FieldError errors={[errors.next]} />
        </Field>
        {serverError && (
          <p role="alert" className="rounded-xl bg-expense-soft px-3.5 py-2.5 text-sm text-expense">
            {serverError}
          </p>
        )}
        <Button type="submit" disabled={change.isPending} className="h-11 rounded-xl">
          {change.isPending && <Loader2 className="animate-spin" />}
          Change password
        </Button>
      </form>
    </section>
  );
}

const emailSchema = z.object({
  password: z.string().min(1, "Enter your current password"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
});
type EmailValues = z.infer<typeof emailSchema>;

function EmailSection({ email }: { email: string | undefined }) {
  const change = useChangeEmail();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EmailValues>({ resolver: zodResolver(emailSchema) });

  async function onSubmit(values: EmailValues) {
    setServerError(null);
    try {
      await change.mutateAsync({ current_password: values.password, new_email: values.email.trim() });
      toast.success(`Check ${values.email.trim()} for a confirmation link.`);
      reset({ password: "", email: "" });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not change email");
    }
  }

  return (
    <section className={cn(card, "space-y-3 p-5")} aria-labelledby="email">
      <h2 id="email" className="text-sm font-medium">
        Email
      </h2>
      <p className="text-sm text-muted-foreground">
        Currently <span className="font-medium text-foreground">{email ?? "…"}</span>
      </p>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="email-password">Current password</FieldLabel>
          <Input id="email-password" type="password" autoComplete="current-password" className="h-11 rounded-xl bg-card px-3.5" {...register("password")} />
          <FieldError errors={[errors.password]} />
        </Field>
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="new-email">New email</FieldLabel>
          <Input id="new-email" type="email" autoComplete="email" className="h-11 rounded-xl bg-card px-3.5" {...register("email")} />
          <FieldError errors={[errors.email]} />
        </Field>
        {serverError && (
          <p role="alert" className="rounded-xl bg-expense-soft px-3.5 py-2.5 text-sm text-expense">
            {serverError}
          </p>
        )}
        <Button type="submit" disabled={change.isPending} className="h-11 rounded-xl">
          {change.isPending && <Loader2 className="animate-spin" />}
          Change email
        </Button>
      </form>
    </section>
  );
}

function DataSection() {
  const start = useStartExport();
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [startError, setStartError] = useState<string | null>(null);
  const { data: job } = useJob<ExportResult>(jobId);

  async function onExport() {
    setStartError(null);
    try {
      const { job_id } = await start.mutateAsync();
      setJobId(job_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start export";
      setStartError(message === "file storage isn't configured" ? "Export isn't available on this server." : message);
    }
  }

  const busy = start.isPending || (job && job.status !== "done" && job.status !== "failed");

  return (
    <section className={cn(card, "space-y-3 p-5")} aria-labelledby="your-data">
      <h2 id="your-data" className="text-sm font-medium">
        Your data
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="h-11 rounded-xl" onClick={onExport} disabled={!!busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          Export my data
        </Button>
        {job?.status === "done" && job.result && (
          <a
            href={job.download_url ?? undefined}
            download
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-income-soft px-4 text-sm font-medium text-income hover:brightness-95"
          >
            <Download className="size-4" /> Download ({job.result.rows} rows)
          </a>
        )}
        <Link href="/account/import" className="inline-flex h-11 items-center gap-2 rounded-xl border border-input bg-card px-4 text-sm font-medium hover:bg-muted">
          <FileUp className="size-4" /> Import from CSV
        </Link>
      </div>
      {(startError || (job?.status === "failed" && job.error)) && (
        <p role="alert" className="rounded-xl bg-expense-soft px-3.5 py-2.5 text-sm text-expense">
          {startError ?? job?.error}
        </p>
      )}
    </section>
  );
}

function DeleteAccountSection() {
  const del = useDeleteAccount();
  const logout = useLogoutAndLeave();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setError(null);
    try {
      await del.mutateAsync(password);
      // Same exit path as logout: hard-navigate so the service worker's cache wipe (triggered by the
      // /auth/delete request itself, same as logout) finishes and nothing cached outlives the account.
      logout.run();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account");
    }
  }

  return (
    <section className="pt-2">
      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setPassword("");
            setError(null);
          }
        }}
      >
        <AlertDialogTrigger render={<Button variant="ghost" className="h-11 w-full rounded-2xl text-expense hover:bg-expense-soft hover:text-expense" />}>
          <Trash2 /> Delete account
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Every memo, category and source is permanently deleted. This can&apos;t be undone. Enter your password to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="delete-password">Password</FieldLabel>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              className="h-11 rounded-xl bg-card px-3.5"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
            />
            <FieldError>{error}</FieldError>
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete} disabled={del.isPending || !password}>
              {del.isPending && <Loader2 className="animate-spin" />}
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
