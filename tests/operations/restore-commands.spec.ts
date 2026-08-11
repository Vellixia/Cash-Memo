import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  executeRestoreReconcile,
  syntheticInput,
} from "../../scripts/operations/restore-reconcile.mjs";
import { RestoreCopyLifecycle } from "../../scripts/operations/restore-copy-lifecycle.mjs";

describe("restore reconciliation command", () => {
  it("returns PASS only after complete pre-network checklist", () => {
    expect(executeRestoreReconcile(syntheticInput("pass"))).toEqual({
      checklist: "complete",
      result: "PASS",
      safeBlockerClass: null,
    });
  });

  it.each([
    "ledger_unavailable",
    "missing_key",
    "incomplete_reconciliation",
    "verification_failed",
  ])("returns content-free BLOCKED for %s", (blocker) => {
    expect(executeRestoreReconcile(syntheticInput(blocker))).toMatchObject({
      result: "BLOCKED",
      safeBlockerClass: blocker,
    });
  });

  it("requires explicit mode and emits no identifiers or content", () => {
    const run = spawnSync(process.execPath, ["scripts/operations/restore-reconcile.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toBe(
      "RESTORE_RECONCILIATION=BLOCKED blocker=explicit-mode-required\n",
    );
  });
});

describe("restore-copy lifecycle", () => {
  it("registers, inventories, isolates, reconciles, verifies, releases, and destroys", () => {
    const copy = new RestoreCopyLifecycle();
    copy.createAndRegister();
    copy.tagAndConfirmInventory();
    copy.forceNetworkIsolation();
    copy.markReconciled("PASS");
    copy.verify();
    copy.releaseControlled();
    expect(copy.cleanupBlocker()).toBe(true);
    copy.destroyAndVerify();
    expect(copy.contentSafeStatus()).toMatchObject({
      cleanupBlocker: false,
      inventoryVisible: false,
      state: "destroyed_verified",
    });
  });

  it("blocks release before network isolation and reconciliation", () => {
    const copy = new RestoreCopyLifecycle();
    copy.createAndRegister();
    expect(() => {
      copy.releaseControlled();
    }).toThrow("RESTORE_COPY_RELEASE_BLOCKED");
  });

  it("keeps existing restore copy as cleanup blocker until verified destruction", () => {
    const copy = new RestoreCopyLifecycle();
    copy.createAndRegister();
    expect(copy.cleanupBlocker()).toBe(true);
    copy.destroyAndVerify();
    expect(copy.cleanupBlocker()).toBe(false);
  });
});
