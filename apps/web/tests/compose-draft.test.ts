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
    const db = new ComposeDraftDatabase();
    const first = await db.openCreate("account-a", payload);
    const loaded = await db.loadForAccount("account-a", first.draftId);
    expect(loaded?.creationId).toBe(first.creationId);
    expect(loaded?.formPayload).toEqual(payload);
    await db.markRetryable("account-a", first.draftId);
    expect(
      (await db.loadForAccount("account-a", first.draftId))?.creationId,
    ).toBe(first.creationId);
    db.close();
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
});
