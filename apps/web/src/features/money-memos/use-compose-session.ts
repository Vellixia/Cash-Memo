"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ComposeDraftDatabase,
  type ComposeDraft,
  type ComposePayload,
} from "@/lib/compose/db";

const emptyPayload: ComposePayload = {};

export function useComposeSession(accountId: string | null) {
  const database = useRef<ComposeDraftDatabase | null>(null);
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (accountId === null) {
      return;
    }
    const db = new ComposeDraftDatabase();
    database.current = db;
    let active = true;
    void db.listForAccount(accountId).then(async (drafts) => {
      const current =
        drafts.find((value) => value.mode === "create") ??
        (await db.openCreate(accountId, emptyPayload));
      if (active) {
        setDraft(current);
        setReady(true);
      }
    });
    return () => {
      active = false;
      database.current = null;
      db.close();
    };
  }, [accountId]);

  const autosave = useCallback(
    async (payload: ComposePayload) => {
      if (database.current === null || draft === null || accountId === null)
        return;
      await database.current.save(accountId, draft.draftId, payload);
      setDraft({
        ...draft,
        formPayload: { ...payload },
        updatedAt: Date.now(),
      });
    },
    [accountId, draft],
  );

  const retainFailure = useCallback(async () => {
    if (database.current === null || draft === null || accountId === null)
      return;
    await database.current.markRetryable(accountId, draft.draftId);
  }, [accountId, draft]);

  const complete = useCallback(async () => {
    if (database.current === null || draft === null || accountId === null)
      return;
    await database.current.complete(accountId, draft.draftId);
    setDraft(null);
  }, [accountId, draft]);

  const discard = useCallback(async () => {
    if (database.current === null || draft === null || accountId === null)
      return;
    await database.current.discard(accountId, draft.draftId);
    setDraft(null);
  }, [accountId, draft]);

  return { draft, ready, autosave, retainFailure, complete, discard };
}
