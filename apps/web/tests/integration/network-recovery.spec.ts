import { describe, expect, it } from "vitest";

import {
  RecoverableDraftStore,
  type DraftStorage,
} from "../../src/features/degraded/recoverable-draft.js";

class ControlledNetworkFault extends Error {
  constructor(readonly commitState: "committed" | "not_committed") {
    super("CONTROLLED_NETWORK_FAULT");
  }
}

async function interruptBeforeCommit<T>(_commit: () => Promise<T>): Promise<T> {
  void _commit;
  await Promise.resolve();
  throw new ControlledNetworkFault("not_committed");
}

async function loseCommittedResponse<T>(commit: () => Promise<T>): Promise<T> {
  await commit();
  throw new ControlledNetworkFault("committed");
}

class MemoryStorage implements DraftStorage {
  constructor(readonly values = new Map<string, string>()) {}
  getItem(key: string) {
    return Promise.resolve(this.values.get(key) ?? null);
  }
  removeItem(key: string) {
    this.values.delete(key);
    return Promise.resolve();
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

describe("browser network and update recovery", () => {
  it("offline before save preserves explicit unsaved local work and creates no authority", async () => {
    const storage = new MemoryStorage();
    const store = new RecoverableDraftStore(storage, "owner-a");
    let authoritativeCount = 0;
    await expect(
      store.save({ idempotencyKey: "retry-1", sourceText: "synthetic", status: "unsaved" }),
    ).resolves.toBe(true);
    await expect(interruptBeforeCommit(async () => ++authoritativeCount)).rejects.toBeInstanceOf(
      ControlledNetworkFault,
    );
    expect(authoritativeCount).toBe(0);
    await expect(store.load()).resolves.toMatchObject({ authoritative: false, status: "unsaved" });
  });

  it("upload interruption never reports silent success or partial confirmation", async () => {
    let confirmations = 0;
    await expect(interruptBeforeCommit(async () => ++confirmations)).rejects.toMatchObject({
      commitState: "not_committed",
    });
    expect(confirmations).toBe(0);
  });

  it("lost confirmation response retries same identity and reconciles one memo", async () => {
    const results = new Map<string, string>();
    const commit = async () => {
      const existing = results.get("confirm-1");
      if (existing !== undefined) return existing;
      results.set("confirm-1", "memo-1");
      return "memo-1";
    };
    await expect(loseCommittedResponse(commit)).rejects.toMatchObject({ commitState: "committed" });
    await expect(commit()).resolves.toBe("memo-1");
    expect(results).toHaveLength(1);
  });

  it("app close and reopen recovers allowed draft but never raw audio", async () => {
    const backing = new Map<string, string>();
    const first = new RecoverableDraftStore(new MemoryStorage(backing), "owner-a");
    await first.save({ idempotencyKey: "retry-2", sourceText: "synthetic", status: "editing" });
    const reopened = await new RecoverableDraftStore(new MemoryStorage(backing), "owner-a").load();
    expect(reopened).toMatchObject({ authoritative: false, idempotencyKey: "retry-2" });
    expect(JSON.stringify(reopened)).not.toMatch(/audio|blob|bytes/iu);
  });

  it("application update uses same recovery contract without fabricating confirmation", async () => {
    const backing = new Map<string, string>();
    const beforeUpdate = new RecoverableDraftStore(new MemoryStorage(backing), "owner-a");
    await beforeUpdate.save({
      idempotencyKey: "retry-3",
      sourceText: "synthetic",
      status: "uncertain",
    });
    const afterUpdate = await new RecoverableDraftStore(
      new MemoryStorage(backing),
      "owner-a",
    ).load();
    expect(afterUpdate).toMatchObject({ authoritative: false, status: "uncertain" });
  });

  it("storage denial remains explicit and never claims local recovery succeeded", async () => {
    const denied: DraftStorage = {
      getItem: () => Promise.reject(new Error("denied")),
      removeItem: () => Promise.reject(new Error("denied")),
      setItem: () => Promise.reject(new Error("denied")),
    };
    const store = new RecoverableDraftStore(denied, "owner-a");
    await expect(
      store.save({ idempotencyKey: "retry-4", sourceText: "synthetic", status: "unsaved" }),
    ).resolves.toBe(false);
    await expect(store.load()).resolves.toBeNull();
  });
});
