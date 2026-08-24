"use client";

import { useSignOut } from "../../../features/auth/use-session";
import { Button } from "../../../components/ui/button";

export default function AppHomePage() {
  const signOut = useSignOut();
  return <section><p className="muted">Private money journal</p><h1>Your journal</h1><div className="dialog"><h2>Start with one memo</h2><p>No totals yet. Add a manual memo when you are ready.</p><p>Assisted capture stays a draft until you review and confirm it.</p><Button type="button" onClick={() => void signOut("/app")}>Sign out</Button></div></section>;
}

