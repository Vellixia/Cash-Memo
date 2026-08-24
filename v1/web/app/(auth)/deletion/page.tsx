"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getGetAccountDeletionQueryKey, useCancelAccountDeletion, useGetAccountDeletion } from "../../../generated/api";
import { Button } from "../../../components/ui/button";
import { useSignOut } from "../../../features/auth/use-session";

export default function DeletionPage() {
  const query = useGetAccountDeletion({ query: { retry: false } });
  const cancel = useCancelAccountDeletion();
  const client = useQueryClient();
  const router = useRouter();
  const signOut = useSignOut();
  const deletion = query.data?.data;

  useEffect(() => { if (cancel.isSuccess) { void client.invalidateQueries({ queryKey: getGetAccountDeletionQueryKey() }); } }, [cancel.isSuccess, client]);

  if (query.isPending) return <main className="public-page"><p role="status">Loading deletion status…</p></main>;
  if (query.isError) return <main className="public-page"><section className="dialog"><h1>Deletion status unavailable</h1><p role="alert">Try again when service is available.</p><Button type="button" onClick={() => { router.replace("/app"); }}>Return to journal</Button></section></main>;

  const pending = deletion?.status === "pending" || deletion?.status === "requested";
  return <main className="public-page"><section className="dialog deletion-card"><h1>Account deletion</h1><p role="status">Status: {deletion?.status ?? "none"}</p>{deletion?.deletion_due_at ? <p>Scheduled for {new Date(deletion.deletion_due_at).toLocaleDateString()}</p> : null}{pending ? <Button type="button" variant="secondary" disabled={cancel.isPending} onClick={() => { cancel.mutate(); }}>Cancel deletion</Button> : null}<Button type="button" variant="quiet" onClick={() => { void signOut("/app"); }}>Sign out</Button></section></main>;
}
