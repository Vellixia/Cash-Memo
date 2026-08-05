import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";

import {
  ComposeDraftDatabase,
  localPartitionTag,
  type ComposePayload,
} from "../src/lib/compose/db";

const payload: ComposePayload = {
  amount: "42.50",
  note: "byte exact e\u0301\r\n",
};

afterEach(async () => {
  await ComposeDraftDatabase.deleteDatabase();
});

describe("durable create compose sessions", () => {
  it("keeps one stable creation UUID through reload and legitimate retries", async () => {
    const firstOpen = new ComposeDraftDatabase();
    const first = await firstOpen.openCreate("account-a", payload);
    firstOpen.close();

    const reopened = new ComposeDraftDatabase();
    const loaded = await reopened.loadForAccount("account-a", first.draftId);
    expect(loaded?.creationId).toBe(first.creationId);
    expect(loaded?.formPayload).toEqual(payload);
    await reopened.markRetryable("account-a", first.draftId);
    expect(
      (await reopened.loadForAccount("account-a", first.draftId))?.creationId,
    ).toBe(first.creationId);
    reopened.close();
  });

  it("partitions by one-way account tag and deletes only on success or discard", async () => {
    const db = new ComposeDraftDatabase();
    const draft = await db.openCreate("account-a", payload);
    expect(await db.loadForAccount("account-b", draft.draftId)).toBeUndefined();
    expect(draft.userPartition).toBe(await localPartitionTag("account-a"));
    expect(draft.userPartition).not.toContain("account-a");
    await db.complete("account-a", draft.draftId);
    expect(await db.loadForAccount("account-a", draft.draftId)).toBeUndefined();

    const discarded = await db.openCreate("account-a", payload);
    await db.discard("account-a", discarded.draftId);
    expect(
      await db.loadForAccount("account-a", discarded.draftId),
    ).toBeUndefined();
    db.close();
  });

  it("converges concurrent account opens on one active create session", async () => {
    const firstDatabase = new ComposeDraftDatabase();
    const secondDatabase = new ComposeDraftDatabase();
    const [first, second] = await Promise.all([
      firstDatabase.openCreate("account-a", payload),
      secondDatabase.openCreate("account-a", {}),
    ]);

    expect(second.draftId).toBe(first.draftId);
    expect(second.creationId).toBe(first.creationId);
    expect(await firstDatabase.listForAccount("account-a")).toHaveLength(1);
    firstDatabase.close();
    secondDatabase.close();
  });
});
