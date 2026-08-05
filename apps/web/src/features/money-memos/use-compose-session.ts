"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ComposeDraftDatabase,
  type ComposeDraft,
  type ComposePayload,
} from "@/lib/compose/db";

const emptyPayload: ComposePayload = {};

export interface ComposeSessionDatabase {
  listForAccount(accountId: string): Promise<ComposeDraft[]>;
  openCreate(accountId: string, payload: ComposePayload): Promise<ComposeDraft>;
  save(
    accountId: string,
    draftId: string,
    payload: ComposePayload,
  ): Promise<void>;
  markRetryable(accountId: string, draftId: string): Promise<void>;
  complete(accountId: string, draftId: string): Promise<void>;
  discard(accountId: string, draftId: string): Promise<void>;
  close(): void;
}

type LoadedDraft = Readonly<{ accountId: string; draft: ComposeDraft | null }>;
type DatabaseFactory = () => ComposeSessionDatabase;
const createDatabase: DatabaseFactory = () => new ComposeDraftDatabase();

/** Account-gated durable compose session with serialized latest-write ordering. */
export function useComposeSession(
  accountId: string | null,
  databaseFactory: DatabaseFactory = createDatabase,
) {
  const database = useRef<{
    accountId: string;
    value: ComposeSessionDatabase;
  } | null>(null);
  const operationQueue = useRef<Promise<void>>(Promise.resolve());
  const epoch = useRef(0);
  const completedAccount = useRef<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedDraft | null>(null);
  const loadedRef = useRef<LoadedDraft | null>(null);

  const commitLoaded = useCallback((next: LoadedDraft | null) => {
    loadedRef.current = next;
    setLoaded(next);
  }, []);

  useEffect(() => {
    epoch.current += 1;
    const currentEpoch = epoch.current;
    if (accountId === null) return;

    const db = databaseFactory();
    database.current = { accountId, value: db };
    let active = true;
    const initialization = db
      .listForAccount(accountId)
      .then(async (drafts) => {
        if (!active || epoch.current !== currentEpoch) return;
        const current =
          drafts.find((value) => value.mode === "create") ??
          (await db.openCreate(accountId, emptyPayload));
        if (completedAccount.current === accountId) {
          await db.discard(accountId, current.draftId);
          return;
        }
        if (active && epoch.current === currentEpoch)
          commitLoaded({ accountId, draft: current });
      })
      .catch(() => {
        if (active && epoch.current === currentEpoch)
          commitLoaded({ accountId, draft: null });
      });
    operationQueue.current = operationQueue.current
      .then(() => initialization)
      .catch(() => undefined);

    return () => {
      active = false;
      if (database.current?.value === db) database.current = null;
      const pending = operationQueue.current;
      void pending.finally(() => db.close());
    };
  }, [accountId, commitLoaded, databaseFactory]);

  const draft = loaded?.accountId === accountId ? loaded.draft : null;
  const ready = accountId !== null && loaded?.accountId === accountId;

  const enqueue = useCallback(
    async (
      operation: (
        db: ComposeSessionDatabase,
        ownedAccountId: string,
        ownedDraft: ComposeDraft,
      ) => Promise<void>,
      update: (draft: ComposeDraft) => ComposeDraft | null,
    ) => {
      const binding = database.current;
      const currentLoaded = loadedRef.current;
      if (
        binding === null ||
        currentLoaded?.draft === null ||
        currentLoaded === null ||
        accountId === null ||
        binding.accountId !== accountId ||
        currentLoaded.accountId !== accountId
      )
        throw new Error("Compose session unavailable");
      const ownedDraft = currentLoaded.draft;
      const currentEpoch = epoch.current;
      const execution = operationQueue.current.then(() =>
        operation(binding.value, accountId, ownedDraft),
      );
      operationQueue.current = execution.catch(() => undefined);
      await execution;
      if (epoch.current !== currentEpoch) return;
      const current = loadedRef.current;
      if (
        current?.accountId !== accountId ||
        current.draft?.draftId !== ownedDraft.draftId
      )
        return;
      commitLoaded({ accountId, draft: update(current.draft) });
    },
    [accountId, commitLoaded],
  );

  const autosave = useCallback(
    async (payload: ComposePayload) => {
      await enqueue(
        (db, ownedAccountId, ownedDraft) =>
          db.save(ownedAccountId, ownedDraft.draftId, payload),
        (current) => ({
          ...current,
          formPayload: { ...payload },
          retryState: "editing",
          updatedAt: Date.now(),
        }),
      );
    },
    [enqueue],
  );

  const retainFailure = useCallback(async () => {
    await enqueue(
      (db, ownedAccountId, ownedDraft) =>
        db.markRetryable(ownedAccountId, ownedDraft.draftId),
      (current) => ({ ...current, retryState: "retryable_failure" }),
    );
  }, [enqueue]);

  const complete = useCallback(async () => {
    completedAccount.current = accountId;
    await enqueue(
      (db, ownedAccountId, ownedDraft) =>
        db.complete(ownedAccountId, ownedDraft.draftId),
      () => null,
    );
    if (accountId !== null && loadedRef.current?.accountId === accountId)
      commitLoaded({ accountId, draft: null });
  }, [accountId, commitLoaded, enqueue]);

  const discard = useCallback(async () => {
    await enqueue(
      (db, ownedAccountId, ownedDraft) =>
        db.discard(ownedAccountId, ownedDraft.draftId),
      () => null,
    );
  }, [enqueue]);

  return { draft, ready, autosave, retainFailure, complete, discard };
}
