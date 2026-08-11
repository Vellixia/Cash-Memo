import { describe, expect, it } from "vitest";

import {
  deriveDeletionToken,
  type DeletionEntityType,
} from "../../apps/server/src/modules/deletion/deletion-suppression.port.js";
import {
  RestoreReconciliationService,
  type RestoredAccount,
  type RestoreSuppressionLedger,
} from "../../apps/server/src/modules/deletion/restore-reconciliation.service.js";
import { SuppressionKeyManager } from "../../apps/server/src/modules/deletion/suppression-key-manager.js";

const ACCOUNT_DELETED = "00000000-0000-4000-8000-000000000194";
const ACCOUNT_VALID = "00000000-0000-4000-8000-000000000195";
const MEMO_DELETED = "10000000-0000-4000-8000-000000000194";
const MEMO_VALID = "10000000-0000-4000-8000-000000000195";
const KEY1 = Buffer.from("synthetic-phase13-restore-key-material-v1", "utf8");
const KEY2 = Buffer.from("synthetic-phase13-restore-key-material-v2", "utf8");

class Ledger implements RestoreSuppressionLedger {
  readonly calls: DeletionEntityType[] = [];
  readonly tokens = new Set<string>();
  ledgerState: "available" | "unavailable" | "unverifiable" = "available";
  required = ["key-v1", "key-v2"];

  async hasToken(input: {
    readonly entityType: DeletionEntityType;
    readonly suppressionKeyVersion: string;
    readonly token: Buffer;
  }): Promise<boolean> {
    await Promise.resolve();
    this.calls.push(input.entityType);
    return this.tokens.has(`${input.suppressionKeyVersion}:${input.token.toString("hex")}`);
  }
  async requiredKeyVersions() {
    await Promise.resolve();
    return this.required;
  }
  async status() {
    await Promise.resolve();
    return this.ledgerState;
  }
  add(entityType: DeletionEntityType, id: string, version: string, key: Buffer) {
    const token = deriveDeletionToken({ entityId: id, entityType, suppressionKey: key });
    this.tokens.add(`${version}:${token.toString("hex")}`);
  }
}

function keys() {
  const manager = new SuppressionKeyManager();
  manager.createVersion("key-v1", KEY1, new Date("2025-01-01T00:00:00.000Z"));
  manager.rotate("key-v2", KEY2, new Date("2026-01-01T00:00:00.000Z"));
  return manager;
}

function account(id: string, memoId: string): RestoredAccount {
  return {
    drafts: [
      {
        id: "30000000-0000-4000-8000-000000000194",
        expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
    id,
    memos: [
      { id: memoId, lifecycleState: "active", purgeAfter: null },
      {
        id: "10000000-0000-4000-8000-000000000196",
        lifecycleState: "deleted",
        purgeAfter: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
    sessions: [
      {
        id: "40000000-0000-4000-8000-000000000194",
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
    ],
  };
}

describe("pre-network restore reconciliation", () => {
  it("checks account suppression before memo-level handling", async () => {
    const ledger = new Ledger();
    ledger.add("account", ACCOUNT_DELETED, "key-v1", KEY1);
    const result = await new RestoreReconciliationService(ledger, keys()).reconcile([
      account(ACCOUNT_DELETED, MEMO_VALID),
    ]);
    expect(result).toMatchObject({
      accountFirstVerified: true,
      purgedAccounts: 1,
      purgedMemos: 0,
      releaseAllowed: true,
    });
    expect(ledger.calls).toEqual(["account"]);
  });

  it("matches memo suppression under older retained key version", async () => {
    const ledger = new Ledger();
    ledger.add("money_memo", MEMO_DELETED, "key-v1", KEY1);
    const result = await new RestoreReconciliationService(ledger, keys()).reconcile([
      account(ACCOUNT_VALID, MEMO_DELETED),
    ]);
    expect(result.purgedMemos).toBe(1);
    expect(result.remainingAccounts[0]?.memos.some((memo) => memo.id === MEMO_DELETED)).toBe(false);
  });

  it("sweeps expired Recently Deleted and draft state", async () => {
    const result = await new RestoreReconciliationService(
      new Ledger(),
      keys(),
      () => new Date("2026-10-01T00:00:00.000Z"),
    ).reconcile([account(ACCOUNT_VALID, MEMO_VALID)]);
    expect(result).toMatchObject({ sweptExpiredDrafts: 1, sweptExpiredMemos: 1 });
  });

  it("revokes restored sessions before release", async () => {
    const result = await new RestoreReconciliationService(new Ledger(), keys()).reconcile([
      account(ACCOUNT_VALID, MEMO_VALID),
    ]);
    expect(result.revokedSessions).toBe(1);
    expect(result.remainingAccounts[0]?.sessions).toEqual([]);
  });

  it("preserves valid neighboring account and memo data", async () => {
    const ledger = new Ledger();
    ledger.add("account", ACCOUNT_DELETED, "key-v2", KEY2);
    const result = await new RestoreReconciliationService(ledger, keys()).reconcile([
      account(ACCOUNT_DELETED, MEMO_DELETED),
      account(ACCOUNT_VALID, MEMO_VALID),
    ]);
    expect(result.remainingAccounts.map((item) => item.id)).toEqual([ACCOUNT_VALID]);
    expect(result.remainingAccounts[0]?.memos.some((memo) => memo.id === MEMO_VALID)).toBe(true);
  });

  it.each(["unavailable", "unverifiable"] as const)(
    "blocks release when ledger is %s",
    async (state) => {
      const ledger = new Ledger();
      ledger.ledgerState = state;
      const result = await new RestoreReconciliationService(ledger, keys()).reconcile([
        account(ACCOUNT_VALID, MEMO_VALID),
      ]);
      expect(result.releaseAllowed).toBe(false);
      expect(result.blocker).toBe(
        state === "unavailable" ? "ledger_unavailable" : "verification_failed",
      );
    },
  );

  it("blocks release when a required historical key is missing", async () => {
    const ledger = new Ledger();
    ledger.required = ["key-v0"];
    const result = await new RestoreReconciliationService(ledger, keys()).reconcile([
      account(ACCOUNT_VALID, MEMO_VALID),
    ]);
    expect(result).toMatchObject({ blocker: "missing_key", releaseAllowed: false });
  });

  it("blocks release on incomplete verification with zero partial release", async () => {
    const result = await new RestoreReconciliationService(new Ledger(), keys()).reconcile(
      [account(ACCOUNT_VALID, MEMO_VALID)],
      false,
    );
    expect(result).toMatchObject({
      blocker: "incomplete_reconciliation",
      releaseAllowed: false,
      remainingAccounts: [],
    });
  });
});
