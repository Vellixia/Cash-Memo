"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getGetAccountDeletionQueryKey, useCancelAccountDeletion, useGetAccountDeletion } from "../../../generated/api";
import { Button } from "../../../components/ui/button";
import { useSignOut } from "../../../features/auth/use-session";
import { clearSessionState, deletionActionsForStatus, getDeletionErrorDestination } from "../../../lib/auth/session";

export default function DeletionPage() {
  const query = useGetAccountDeletion({ query: { retry: false } });
  const cancel = useCancelAccountDeletion();
  const client = useQueryClient();
  const router = useRouter();
  const signOut = useSignOut();
  const deletion = query.data?.data;
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (cancel.isSuccess) void client.invalidateQueries({ queryKey: getGetAccountDeletionQueryKey() });
  }, [cancel.isSuccess, client]);

  useEffect(() => {
    if (query.isError) {
      clearSessionState(client);
      router.replace(getDeletionErrorDestination(query.error));
    }
  }, [client, query.error, query.isError, router]);

  if (query.isPending) return <main className="public-page"><p role="status">Loading deletion status…</p></main>;
  if (query.isError) return <main className="public-page"><p role="status">Returning to sign in…</p></main>;

  const pending = deletion ? deletionActionsForStatus(deletion.status).canCancel : false;
  return <main className="public-page"><section className="dialog deletion-card"><h1>Account deletion</h1><p role="status">Status: {deletion?.status ?? "none"}</p>{deletion?.deletion_due_at ? <p>Scheduled for {new Date(deletion.deletion_due_at).toLocaleDateString()}</p> : null}{pending ? <form onSubmit={(event) => { event.preventDefault(); cancel.mutate({ data: { password } }); }}><label htmlFor="cancel-deletion-password">Confirm password</label><input id="cancel-deletion-password" type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); }} required /><Button type="submit" variant="secondary" disabled={cancel.isPending}>Cancel deletion</Button></form> : null}<Button type="button" variant="quiet" onClick={() => { void signOut("/app"); }}>Sign out</Button></section></main>;
}
