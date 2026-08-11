import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  serializeExportV1,
  type ExportV1Snapshot,
} from "../../src/modules/export/export-v1.serializer.js";

function requiredFile(files: ReadonlyMap<string, Buffer>, name: string): Buffer {
  const value = files.get(name);
  expect(value).toBeDefined();
  if (value === undefined) throw new Error("EXPORT_FILE_MISSING");
  return value;
}

const snapshot: ExportV1Snapshot = {
  accountId: "11111111-1111-4111-8111-111111111111",
  categories: [
    {
      createdAt: "2026-08-01T00:00:00.000Z",
      id: "33333333-3333-4333-8333-333333333333",
      kind: "expense",
      name: "=Unsafe label",
      normalizedName: "=unsafe label",
      revision: "2",
      status: "inactive",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
    {
      createdAt: "2026-08-01T00:00:00.000Z",
      id: "22222222-2222-4222-8222-222222222222",
      kind: "expense",
      name: "Food",
      normalizedName: "food",
      revision: "1",
      status: "active",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ],
  createdAt: "2026-08-11T12:00:00.000Z",
  currencyRegistryVersions: ["registry-v1", "registry-v1"],
  drafts: [
    {
      authoritative: false,
      captureStartedAt: "2026-08-11T09:00:00.000Z",
      captureTimezone: "Asia/Jakarta",
      createdAt: "2026-08-11T09:00:00.000Z",
      expiresAt: "2026-08-18T09:00:00.000Z",
      fields: { amount: null, currency: "USD" },
      id: "77777777-7777-4777-8777-777777777777",
      lastActivityAt: "2026-08-11T09:00:00.000Z",
      origin: "natural_language",
      revision: "1",
      sourceCompleteness: "incomplete",
      sourceText: "+formula-like draft",
      status: "reviewable",
    },
  ],
  exportId: "99999999-9999-4999-8999-999999999999",
  includeRecoverableDrafts: true,
  lifecycle: [
    {
      deletedAt: "2026-08-10T00:00:00.000Z",
      eventTime: "2026-08-10T00:00:00.000Z",
      priorState: "archived",
      purgeAfter: "2026-09-09T00:00:00.000Z",
      state: "recently_deleted",
      subjectId: "88888888-8888-4888-8888-888888888888",
      subjectType: "money_memo",
    },
  ],
  moneyMemos: [
    {
      amount: "100.50",
      amountMinor: "10050",
      authoritative: true,
      categoryId: null,
      createdAt: "2026-08-03T03:00:00.000Z",
      currency: "USD",
      currencyExponent: 2,
      currencyRegistryVersion: "registry-v1",
      direction: "income",
      id: "66666666-6666-4666-8666-666666666666",
      lifecycle: "archived",
      moneySpaceId: null,
      note: "@unsafe memo",
      occurredAt: "2026-08-03T03:00:00.000Z",
      occurredLocal: "2026-08-03T10:00:00.000",
      occurredOffsetMinutes: 420,
      occurredTimezone: "Asia/Jakarta",
      origin: "manual",
      planningStatus: null,
      purpose: null,
      revision: "3",
      timezoneDatabaseVersion: "2026a",
      updatedAt: "2026-08-04T03:00:00.000Z",
    },
    {
      amount: "85000",
      amountMinor: "85000",
      authoritative: true,
      categoryId: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-08-02T03:00:00.000Z",
      currency: "IDR",
      currencyExponent: 0,
      currencyRegistryVersion: "registry-v1",
      direction: "expense",
      id: "55555555-5555-4555-8555-555555555555",
      lifecycle: "active",
      moneySpaceId: "44444444-4444-4444-8444-444444444444",
      note: "Lunch",
      occurredAt: "2026-08-02T03:00:00.000Z",
      occurredLocal: "2026-08-02T10:00:00.000",
      occurredOffsetMinutes: 420,
      occurredTimezone: "Asia/Jakarta",
      origin: "manual",
      planningStatus: "unplanned",
      purpose: "personal",
      revision: "1",
      timezoneDatabaseVersion: "2026a",
      updatedAt: "2026-08-02T03:00:00.000Z",
    },
  ],
  moneySpaces: [
    {
      createdAt: "2026-08-01T00:00:00.000Z",
      id: "44444444-4444-4444-8444-444444444444",
      name: "Personal",
      normalizedName: "personal",
      revision: "1",
      status: "active",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ],
  preferences: {
    acceptedPrivacyNoticeAt: "2026-08-01T00:00:00.000Z",
    acceptedPrivacyNoticeVersion: "privacy-v1",
    defaultCurrency: "IDR",
    locale: "en-ID",
    reportingTimezone: "Asia/Jakarta",
    revision: "1",
  },
  snapshotCutoff: "2026-08-11T12:00:00.000Z",
};

describe("export v1 contract", () => {
  it("serializes identical snapshots to identical ZIP bytes and checksums", () => {
    const first = serializeExportV1(snapshot);
    const second = serializeExportV1(snapshot);
    expect(first.archive.equals(second.archive)).toBe(true);
    expect(first.archive.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(first.archiveSha256).toBe(createHash("sha256").update(first.archive).digest("hex"));
    expect(first.manifestSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("uses fixed bytewise file ordering and complete manifest checksums", () => {
    const result = serializeExportV1(snapshot);
    const names = [...result.files.keys()];
    expect(names).toEqual([...names].sort());
    expect(names).toEqual([
      "categories.csv",
      "categories.json",
      "drafts.csv",
      "drafts.json",
      "lifecycle.json",
      "manifest.json",
      "money-memos.csv",
      "money-memos.json",
      "money-spaces.csv",
      "money-spaces.json",
      "preferences.json",
    ]);
    for (const file of result.manifest.files) {
      const bytes = result.files.get(file.name);
      expect(bytes).toBeDefined();
      if (bytes === undefined) throw new Error("EXPORT_FILE_MISSING");
      expect(file.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(file.bytes).toBe(String(bytes.length));
    }
  });

  it("orders memo rows by occurredAt then immutable ID", () => {
    const records = JSON.parse(
      requiredFile(serializeExportV1(snapshot).files, "money-memos.json").toString("utf8"),
    ) as { records: { id: string }[] };
    expect(records.records.map((row) => row.id)).toEqual([
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ]);
  });

  it("preserves exact currency, local-time, lifecycle, and string money values", () => {
    const text = requiredFile(serializeExportV1(snapshot).files, "money-memos.json").toString(
      "utf8",
    );
    expect(text).toContain('"amount":"100.50"');
    expect(text).toContain('"amountMinor":"10050"');
    expect(text).toContain('"currency":"USD"');
    expect(text).toContain('"occurredTimezone":"Asia/Jakarta"');
    expect(text).toContain('"lifecycle":"archived"');
  });

  it("keeps currencies independent and contains no conversion fields", () => {
    const result = serializeExportV1(snapshot);
    const all = [...result.files.values()].map((value) => value.toString("utf8")).join("\n");
    expect(all).toContain("IDR");
    expect(all).toContain("USD");
    expect(all).not.toMatch(/exchangeRate|baseCurrency|convertedTotal|equivalentValue|grandTotal/u);
    expect(result.manifest.valueEncoding).toContain("no conversion");
  });

  it("labels recoverable drafts non-authoritative and excludes them when not requested", () => {
    const included = serializeExportV1(snapshot);
    expect(requiredFile(included.files, "drafts.json").toString("utf8")).toContain(
      '"authoritative":false',
    );
    const excluded = serializeExportV1({
      ...snapshot,
      includeRecoverableDrafts: false,
    });
    expect(excluded.files.has("drafts.json")).toBe(false);
    expect(excluded.files.has("drafts.csv")).toBe(false);
    expect(excluded.manifest.includesRecoverableDrafts).toBe(false);
  });

  it("keeps recently deleted metadata outside confirmed memo rows", () => {
    const result = serializeExportV1(snapshot);
    expect(requiredFile(result.files, "money-memos.json").toString("utf8")).not.toContain(
      "88888888-8888-4888-8888-888888888888",
    );
    expect(requiredFile(result.files, "lifecycle.json").toString("utf8")).toContain(
      "88888888-8888-4888-8888-888888888888",
    );
  });

  it.each(["=SUM(A1:A2)", "+1", "-1", "@cmd", "\tvalue", "\rvalue"])(
    "protects dangerous CSV prefix %j without changing JSON",
    (dangerous) => {
      const firstMemo = snapshot.moneyMemos[0];
      if (firstMemo === undefined) throw new Error("EXPORT_FIXTURE_MEMO_MISSING");
      const result = serializeExportV1({
        ...snapshot,
        moneyMemos: [{ ...firstMemo, note: dangerous }],
      });
      expect(requiredFile(result.files, "money-memos.csv").toString("utf8")).toContain(
        `'${dangerous}`,
      );
      expect(requiredFile(result.files, "money-memos.json").toString("utf8")).toContain(
        JSON.stringify(dangerous),
      );
      expect(result.manifest.csvCellEncoding).toBe("rfc4180;dangerous-prefix-apostrophe");
    },
  );

  it("exports no session, secret, raw audio, detector, or internal suppression fields", () => {
    const all = [...serializeExportV1(snapshot).files.values()]
      .map((value) => value.toString("utf8"))
      .join("\n");
    expect(all).not.toMatch(
      /sessionToken|reauthGrant|providerSecret|rawAudio|detectorMaterial|deletionToken|suppressionKey/u,
    );
  });
});
