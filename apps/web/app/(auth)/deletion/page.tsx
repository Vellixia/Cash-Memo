"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getGetAccountDeletionQueryKey,
  useCancelAccountDeletion,
  useGetAccountDeletion,
} from "../../../generated/api";
import { AuthGate } from "../../../components/auth-gate";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "../../../components/ui/card";
import { Field, FieldGroup, FieldLabel } from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";
import { useSignOut } from "../../../features/auth/use-session";
import {
  clearSessionState,
  deletionActionsForStatus,
  getDeletionErrorDestination,
} from "../../../lib/auth/session";

/** Restricted mode: no AppShell, no sidebar, no bottom navigation, no financial queries. */
export default function DeletionPage() {
  return (
    <AuthGate allow="deletion-only">
      <DeletionPanel />
    </AuthGate>
  );
}

function DeletionPanel() {
  const query = useGetAccountDeletion({ query: { retry: false } });
  const cancel = useCancelAccountDeletion();
  const client = useQueryClient();
  const router = useRouter();
  const signOut = useSignOut();
  const deletion = query.data?.data;
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (cancel.isSuccess)
      void client.invalidateQueries({ queryKey: getGetAccountDeletionQueryKey() });
  }, [cancel.isSuccess, client]);

  useEffect(() => {
    if (query.isError) {
      clearSessionState(client);
      router.replace(getDeletionErrorDestination(query.error));
    }
  }, [client, query.error, query.isError, router]);

  if (query.isPending || query.isError) {
    return (
      <main className="public-page">
        {query.isPending ? (
          <p role="status">Loading deletion status…</p>
        ) : (
          <p role="alert">Returning to sign in…</p>
        )}
      </main>
    );
  }

  const pending = deletion ? deletionActionsForStatus(deletion.status).canCancel : false;
  // Only the server's own credential rejection may tell the user their password was wrong; a 500 or
  // a dropped connection must not push them into retrying and burning their rate-limit budget.
  const cancelRejectedPassword =
    (cancel.error as { response?: { status?: number } } | null | undefined)?.response?.status ===
    401;

  return (
    <main className="public-page">
      <Card className="w-full max-w-lg ring-foreground/12 [--card-spacing:--spacing(6)]">
        <CardHeader>
          <h1
            data-slot="card-title"
            className="font-heading m-0 text-xl leading-snug font-semibold tracking-tight"
          >
            Account deletion
          </h1>
          <CardDescription>
            Cashmemo is in restricted mode. Only deletion controls are available.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p role="status" className="m-0 text-sm font-semibold">
            Status: {deletion?.status ?? "none"}
          </p>
          {deletion?.deletion_due_at ? (
            <p className="m-0 text-sm text-muted-foreground">
              Scheduled for {new Date(deletion.deletion_due_at).toLocaleDateString()}
            </p>
          ) : null}
          {cancel.isError ? (
            <Alert variant="destructive" className="border-destructive/30 bg-destructive/8">
              <AlertDescription className="text-destructive">
                {cancelRejectedPassword
                  ? "Password was not accepted. Deletion is still scheduled."
                  : "Could not cancel deletion. Deletion is still scheduled."}
              </AlertDescription>
            </Alert>
          ) : null}
          {pending ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                cancel.mutate({ data: { password } });
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="cancel-deletion-password">Confirm password</FieldLabel>
                  <Input
                    id="cancel-deletion-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                    }}
                    required
                  />
                </Field>
                <Button
                  type="submit"
                  size="lg"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? "Cancelling…" : "Cancel deletion"}
                </Button>
              </FieldGroup>
            </form>
          ) : null}
          <Button
            type="button"
            variant="quiet"
            className="w-full sm:w-auto sm:self-start"
            onClick={() => {
              void signOut("/app");
            }}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
