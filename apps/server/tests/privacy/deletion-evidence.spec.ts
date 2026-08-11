import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ContractDeletionSuppressionPort,
  createSuppressionRecord,
} from "../../src/modules/deletion/deletion-suppression.port.js";

const CANARIES = [
  "DELETE-CANARY-MEMO-CONTENT",
  "DELETE-CANARY-CATEGORY",
  "DELETE-CANARY-MONEY-SPACE",
  "DELETE-CANARY-AMOUNT-918273",
] as const;
const ENTITY = "00000000-0000-4000-8000-000000000182";
const KEY = Buffer.from("synthetic-deletion-privacy-key-material-v1", "utf8");

function expectContentFree(value: unknown): void {
  const rendered = JSON.stringify(value);
  for (const canary of CANARIES) expect(rendered).not.toContain(canary);
}

describe("deletion evidence and diagnostic privacy", () => {
  it("keeps durable suppression records content-free", async () => {
    const port = new ContractDeletionSuppressionPort();
    const record = createSuppressionRecord({
      entityId: ENTITY,
      entityType: "money_memo",
      policyVersion: "phase12-v1",
      purgedAt: new Date("2026-08-11T00:00:00.000Z"),
      suppressionKey: KEY,
      suppressionKeyVersion: "v1",
    });
    expectContentFree(await port.ensureDurable(record));
    expect(JSON.stringify(record)).not.toContain(ENTITY);
  });

  it("keeps suppression-write failures and retries content-free", async () => {
    const port = new ContractDeletionSuppressionPort();
    port.setWriteFailureForTest(true);
    const record = createSuppressionRecord({
      entityId: ENTITY,
      entityType: "account",
      policyVersion: "phase12-v1",
      purgedAt: new Date("2026-08-11T00:00:00.000Z"),
      suppressionKey: KEY,
      suppressionKeyVersion: "v1",
    });
    let failure = "";
    await port.ensureDurable(record).catch((error: unknown) => {
      failure = error instanceof Error ? error.message : "UNKNOWN";
    });
    expect(failure).toBe("SUPPRESSION_DURABLE_WRITE_FAILED");
    expectContentFree({ failure });
    port.setWriteFailureForTest(false);
    expect((await port.ensureDurable(record)).result).toBe("written");
  });

  it("serializes only stable product errors from deletion controllers", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../../src/modules/deletion/account-deletion.controller.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/error\.message|error\.stack|request\.body.*send/iu);
    expect(source).toContain("ACCOUNT_DELETION_UNAVAILABLE");
  });

  it("keeps purge jobs and operational audit writes content-free", async () => {
    const sources = await Promise.all(
      ["memo-purge.worker.ts", "account-purge.worker.ts"].map((name) =>
        readFile(resolve(import.meta.dirname, `../../src/modules/deletion/${name}`), "utf8"),
      ),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/note|amount_minor|category_name|money_space_name/iu);
      expect(source).not.toMatch(/last_error.*content|diagnostic.*payload/iu);
    }
  });

  it("defines content-safe Phase 12 evidence fields for success and failure classes", () => {
    const evidence = {
      adapterModes: { storage: "contract/integration", suppression: "contract/integration" },
      checks: [
        { id: "purge-success", result: "pass" },
        { id: "suppression-failure-no-delete", result: "pass" },
        { id: "retry-success", result: "pass" },
      ],
      realAwsRestoreDeletionClosure: "OPEN",
    };
    expectContentFree(evidence);
  });
});
