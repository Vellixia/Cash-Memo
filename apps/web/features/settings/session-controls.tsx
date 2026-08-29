"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCurrentSession, useLogout, useRevokeAllSessions } from "../../generated/api";
import { clearSessionState } from "../../lib/auth/session";
import { Button } from "../../components/ui/button";
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
} from "../../components/ui/alert-dialog";

export function CurrentSessionSignOut({
  className,
  disabled = false,
  label = "Sign out this session",
  onPendingChange,
}: {
  className?: string;
  disabled?: boolean;
  label?: string;
  onPendingChange?: (pending: boolean) => void;
}) {
  const logout = useLogout();
  const client = useQueryClient();
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function endCurrent() {
    setError(undefined);
    onPendingChange?.(true);
    try {
      await logout.mutateAsync();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not sign out this session. Try again.");
      return;
    } finally {
      onPendingChange?.(false);
    }
    clearSessionState(client);
    router.replace("/login");
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || logout.isPending}
        onClick={() => void endCurrent()}
      >
        {label}
      </Button>
      {error ? (
        <div role="alert" className="field-error">
          <p>{error}</p>
          <Button type="button" variant="quiet" onClick={() => void endCurrent()} disabled={logout.isPending}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function SessionControls() {
  const current = useCurrentSession({ query: { retry: false, refetchOnWindowFocus: false } });
  const revokeAll = useRevokeAllSessions();
  const client = useQueryClient();
  const router = useRouter();
  const [allSessionsError, setAllSessionsError] = useState<string>();
  const [currentLogoutPending, setCurrentLogoutPending] = useState(false);

  async function endAll() {
    setAllSessionsError(undefined);
    try {
      await revokeAll.mutateAsync();
      clearSessionState(client);
      router.replace("/login");
    } catch (value) {
      setAllSessionsError(value instanceof Error ? value.message : "Could not sign out all sessions.");
    }
  }

  return (
    <section className="dialog">
      <h2>Sessions</h2>
      <p>Sign out this browser, or revoke every Cashmemo session on all devices.</p>
      {current.isPending ? <p role="status">Loading current session…</p> : null}
      {current.isError ? <p role="alert" className="field-error">Could not load current session.</p> : null}
      {current.data?.data ? (
        <dl className="session-details">
          <div>
            <dt>Current session</dt>
            <dd>{current.data.data.session_id}</dd>
          </div>
        </dl>
      ) : null}
      <div className="card-actions session-actions">
        <CurrentSessionSignOut
          className="current-session-sign-out"
          disabled={revokeAll.isPending}
          onPendingChange={setCurrentLogoutPending}
        />
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button type="button" variant="danger" disabled={currentLogoutPending || revokeAll.isPending} />}
          >
            Sign out all sessions
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out all sessions?</AlertDialogTitle>
              <AlertDialogDescription>
                This revokes every active Cashmemo session, including this one. You will need to
                sign in again on each browser.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction type="button" variant="danger" onClick={() => void endAll()} disabled={revokeAll.isPending}>
                Confirm sign out all sessions
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {allSessionsError ? (
        <div role="alert" className="field-error">
          <p>{allSessionsError}</p>
          <Button type="button" variant="quiet" onClick={() => void endAll()} disabled={revokeAll.isPending}>
            Try again
          </Button>
        </div>
      ) : null}
    </section>
  );
}
