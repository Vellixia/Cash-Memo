import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  useComposeSession,
  type ComposeSessionDatabase,
} from "../src/features/money-memos/use-compose-session";
import type { ComposeDraft, ComposePayload } from "../src/lib/compose/db";

function draft(accountId: string): ComposeDraft {
  return {
    draftId: `draft-${accountId}`,
    userPartition: `partition-${accountId}`,
    mode: "create",
    creationId: "b4f82dc9-118f-45e4-bbe7-d742f921589f",
    formPayload: {},
    retryState: "editing",
    updatedAt: 1,
  };
}

class FakeDatabase implements ComposeSessionDatabase {
  readonly drafts = new Map<string, ComposeDraft>();
  readonly saves: ComposePayload[] = [];
  maxConcurrentSaves = 0;
  private concurrentSaves = 0;
  private releaseFirstSave: (() => void) | undefined;
  private firstSave = new Promise<void>((resolve) => {
    this.releaseFirstSave = resolve;
  });

  async listForAccount(accountId: string) {
    const existing = this.drafts.get(accountId);
    return existing === undefined ? [] : [existing];
  }

  async openCreate(accountId: string) {
    const created = draft(accountId);
    this.drafts.set(accountId, created);
    return created;
  }

  async save(accountId: string, _draftId: string, payload: ComposePayload) {
    this.concurrentSaves += 1;
    this.maxConcurrentSaves = Math.max(
      this.maxConcurrentSaves,
      this.concurrentSaves,
    );
    this.saves.push(payload);
    if (this.saves.length === 1) await this.firstSave;
    this.drafts.set(accountId, {
      ...(this.drafts.get(accountId) ?? draft(accountId)),
      formPayload: payload,
    });
    this.concurrentSaves -= 1;
  }

  releaseFirst() {
    this.releaseFirstSave?.();
  }

  async markRetryable() {}
  async complete(accountId: string) {
    this.drafts.delete(accountId);
  }
  async discard() {}
  close() {}
}

describe("compose session account and write ordering", () => {
  it("hides the previous draft synchronously while the next account loads", async () => {
    const databases = new Map([
      ["account-a", new FakeDatabase()],
      ["account-b", new FakeDatabase()],
    ]);
    let requestedAccount = "account-a";
    const factory = () => {
      const selected = databases.get(requestedAccount);
      if (selected === undefined) throw new Error("test database missing");
      return selected;
    };
    const { result, rerender } = renderHook(
      ({ accountId }) => useComposeSession(accountId, factory),
      { initialProps: { accountId: "account-a" } },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.draft?.draftId).toBe("draft-account-a");

    requestedAccount = "account-b";
    rerender({ accountId: "account-b" });
    expect(result.current.ready).toBe(false);
    expect(result.current.draft).toBeNull();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.draft?.draftId).toBe("draft-account-b");
  });

  it("serializes out-of-order autosaves so the latest invocation wins", async () => {
    const database = new FakeDatabase();
    const factory = () => database;
    const { result } = renderHook(() =>
      useComposeSession("account-a", factory),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.autosave({ amount: "1.00" });
      second = result.current.autosave({ amount: "2.00" });
    });
    await waitFor(() => expect(database.saves).toHaveLength(1));
    expect(database.maxConcurrentSaves).toBe(1);
    database.releaseFirst();
    await act(async () => {
      await first;
      await second;
    });
    expect(database.saves).toEqual([{ amount: "1.00" }, { amount: "2.00" }]);
    expect(database.maxConcurrentSaves).toBe(1);
    expect(result.current.draft?.formPayload).toEqual({ amount: "2.00" });
  });

  it("completes the current account-bound draft through a callback captured before load", async () => {
    const database = new FakeDatabase();
    const factory = () => database;
    const { result } = renderHook(() =>
      useComposeSession("account-a", factory),
    );
    const completeCapturedBeforeLoad = result.current.complete;
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => completeCapturedBeforeLoad());

    expect(database.drafts.has("account-a")).toBe(false);
    expect(result.current.draft).toBeNull();
  });
});
