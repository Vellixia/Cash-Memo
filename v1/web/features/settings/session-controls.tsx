"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useLogout, useRevokeAllSessions } from "../../generated/api";
import { clearSessionState } from "../../lib/auth/session";
import { Button } from "../../components/ui/button";

export function SessionControls() {
  const logout = useLogout();
  const revokeAll = useRevokeAllSessions();
  const client = useQueryClient();
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function endCurrent() {
    setError(undefined);
    try { await logout.mutateAsync(); }
    catch (value) { setError(value instanceof Error ? value.message : "Could not contact Cashmemo. Local session state was cleared."); }
    finally { clearSessionState(client); router.replace("/login"); }
  }
  async function endAll() {
    setError(undefined);
    try { await revokeAll.mutateAsync(); clearSessionState(client); router.replace("/login"); }
    catch (value) { setError(value instanceof Error ? value.message : "Could not sign out all sessions."); }
  }

  return <section className="dialog"><h2>Sessions</h2><p>Sign out this browser, or revoke every Cashmemo session on all devices.</p><div className="card-actions session-actions"><Button type="button" variant="secondary" disabled={logout.isPending} onClick={() => void endCurrent()}>Sign out this session</Button><Button type="button" variant="danger" disabled={revokeAll.isPending} onClick={() => void endAll()}>Sign out all sessions</Button></div>{error ? <p role="alert" className="field-error">{error}</p> : null}</section>;
}
