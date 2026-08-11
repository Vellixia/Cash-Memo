import { createHash } from "node:crypto";

const EXPORT_SCHEMA_VERSION = "1.0" as const;
const CSV_FORMULA_PROTECTION = "prefix-apostrophe" as const;

type ExportDirection = "expense" | "income";
type ExportLifecycle = "active" | "archived";

interface ExportPreference {
  readonly acceptedPrivacyNoticeAt: string;
  readonly acceptedPrivacyNoticeVersion: string;
  readonly defaultCurrency: string;
  readonly locale: string;
  readonly reportingTimezone: string;
  readonly revision: string;
}

interface ExportCategory {
  readonly createdAt: string;
  readonly id: string;
  readonly kind: ExportDirection;
  readonly name: string;
  readonly normalizedName: string;
  readonly revision: string;
  readonly status: "active" | "inactive";
  readonly updatedAt: string;
}

interface ExportMoneySpace {
  readonly createdAt: string;
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly revision: string;
  readonly status: "active" | "inactive";
  readonly updatedAt: string;
}

interface ExportMoneyMemo {
  readonly amount: string;
  readonly amountMinor: string;
  readonly authoritative: true;
  readonly categoryId: string | null;
  readonly createdAt: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly currencyRegistryVersion: string;
  readonly direction: ExportDirection;
  readonly id: string;
  readonly lifecycle: ExportLifecycle;
  readonly moneySpaceId: string | null;
  readonly note: string | null;
  readonly occurredAt: string;
  readonly occurredLocal: string;
  readonly occurredOffsetMinutes: number;
  readonly occurredTimezone: string;
  readonly origin: "manual" | "natural_language" | "voice";
  readonly planningStatus: "planned" | "unplanned" | null;
  readonly purpose: "mixed" | "personal" | "work" | null;
  readonly revision: string;
  readonly timezoneDatabaseVersion: string;
  readonly updatedAt: string;
}

interface ExportDraft {
  readonly authoritative: false;
  readonly captureStartedAt: string;
  readonly captureTimezone: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly id: string;
  readonly lastActivityAt: string;
  readonly origin: "manual" | "natural_language" | "voice";
  readonly revision: string;
  readonly sourceCompleteness: "complete" | "incomplete" | "not_applicable";
  readonly sourceText: string | null;
  readonly status: "blocked" | "editing" | "failed_recoverable" | "processing" | "reviewable";
}

interface ExportLifecycleEntry {
  readonly deletedAt: string | null;
  readonly eventTime: string;
  readonly priorState: "active" | "archived" | null;
  readonly purgeAfter: string | null;
  readonly state: string;
  readonly subjectId: string;
  readonly subjectType: "account" | "export" | "money_memo";
}

interface ExportV1Snapshot {
  readonly accountId: string;
  readonly categories: readonly ExportCategory[];
  readonly createdAt: string;
  readonly currencyRegistryVersions: readonly string[];
  readonly drafts: readonly ExportDraft[];
  readonly exportId: string;
  readonly includeRecoverableDrafts: boolean;
  readonly lifecycle: readonly ExportLifecycleEntry[];
  readonly moneyMemos: readonly ExportMoneyMemo[];
  readonly moneySpaces: readonly ExportMoneySpace[];
  readonly preferences: ExportPreference;
  readonly snapshotCutoff: string;
}

interface ExportManifestFile {
  readonly bytes: string;
  readonly mediaType: "application/json" | "text/csv";
  readonly name: string;
  readonly records: string;
  readonly sha256: string;
}

interface ExportManifestV1 {
  readonly accountId: string;
  readonly authoritativeRecordType: "money_memo";
  readonly createdAt: string;
  readonly csvCellEncoding: "rfc4180;dangerous-prefix-apostrophe";
  readonly currencyRegistryVersions: readonly string[];
  readonly exportId: string;
  readonly files: readonly ExportManifestFile[];
  readonly includesRecoverableDrafts: boolean;
  readonly schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  readonly snapshotCutoff: string;
  readonly timezoneSemantics: "instant+local+iana-zone+offset";
  readonly valueEncoding: "money-decimal-and-minor-units-as-strings; no conversion";
}

interface SerializedExportV1 {
  readonly archive: Buffer;
  readonly archiveSha256: string;
  readonly filename: string;
  readonly files: ReadonlyMap<string, Buffer>;
  readonly manifest: ExportManifestV1;
  readonly manifestSha256: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJsonValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("EXPORT_NON_FINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJsonValue).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${stableJsonValue(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("EXPORT_UNSUPPORTED_JSON_VALUE");
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(`${stableJsonValue(value)}\n`, "utf8");
}

function protectCsvFormula(value: string): string {
  return /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}

function csvCell(value: boolean | number | string | null): string {
  if (value === null) return "";
  const protectedValue = protectCsvFormula(String(value));
  return /[",\r\n]/u.test(protectedValue)
    ? `"${protectedValue.replaceAll('"', '""')}"`
    : protectedValue;
}

function csvBuffer(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, boolean | number | string | null>>[],
): Buffer {
  const records = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column] ?? null)).join(",")),
  ];
  return Buffer.from(`${records.join("\r\n")}\r\n`, "utf8");
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function deterministicZip(entries: readonly (readonly [string, Buffer])[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, body] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const checksum = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const CATEGORY_COLUMNS = [
  "id",
  "kind",
  "name",
  "status",
  "revision",
  "created_at",
  "updated_at",
] as const;
const MONEY_SPACE_COLUMNS = [
  "id",
  "name",
  "status",
  "revision",
  "created_at",
  "updated_at",
] as const;
const MEMO_COLUMNS = [
  "id",
  "authoritative",
  "direction",
  "amount",
  "amount_minor",
  "currency",
  "currency_exponent",
  "currency_registry_version",
  "occurred_at",
  "occurred_local",
  "occurred_timezone",
  "occurred_offset_minutes",
  "timezone_database_version",
  "category_id",
  "money_space_id",
  "purpose",
  "planning_status",
  "note",
  "origin",
  "lifecycle",
  "revision",
  "created_at",
  "updated_at",
] as const;
const DRAFT_COLUMNS = [
  "id",
  "authoritative",
  "status",
  "origin",
  "source_text",
  "source_completeness",
  "capture_started_at",
  "capture_timezone",
  "last_activity_at",
  "expires_at",
  "revision",
] as const;

function fileDescriptor(name: string, value: Buffer, records: number): ExportManifestFile {
  return Object.freeze({
    bytes: String(value.length),
    mediaType: name.endsWith(".csv") ? "text/csv" : "application/json",
    name,
    records: String(records),
    sha256: sha256(value),
  });
}

function serializeExportV1(snapshot: Readonly<ExportV1Snapshot>): SerializedExportV1 {
  const categories = [...snapshot.categories].sort(
    (a, b) =>
      compareText(a.kind, b.kind) ||
      compareText(a.normalizedName, b.normalizedName) ||
      compareText(a.id, b.id),
  );
  const moneySpaces = [...snapshot.moneySpaces].sort(
    (a, b) => compareText(a.normalizedName, b.normalizedName) || compareText(a.id, b.id),
  );
  const moneyMemos = [...snapshot.moneyMemos].sort(
    (a, b) => compareText(a.occurredAt, b.occurredAt) || compareText(a.id, b.id),
  );
  const drafts = [...snapshot.drafts].sort(
    (a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id),
  );
  const lifecycle = [...snapshot.lifecycle].sort(
    (a, b) => compareText(a.eventTime, b.eventTime) || compareText(a.subjectId, b.subjectId),
  );
  const payloads = new Map<string, { buffer: Buffer; records: number }>();
  payloads.set("preferences.json", {
    buffer: jsonBuffer({ preference: snapshot.preferences, schemaVersion: EXPORT_SCHEMA_VERSION }),
    records: 1,
  });
  payloads.set("categories.json", {
    buffer: jsonBuffer({ records: categories, schemaVersion: EXPORT_SCHEMA_VERSION }),
    records: categories.length,
  });
  payloads.set("categories.csv", {
    buffer: csvBuffer(
      CATEGORY_COLUMNS,
      categories.map((row) => ({
        created_at: row.createdAt,
        id: row.id,
        kind: row.kind,
        name: row.name,
        revision: row.revision,
        status: row.status,
        updated_at: row.updatedAt,
      })),
    ),
    records: categories.length,
  });
  payloads.set("money-spaces.json", {
    buffer: jsonBuffer({ records: moneySpaces, schemaVersion: EXPORT_SCHEMA_VERSION }),
    records: moneySpaces.length,
  });
  payloads.set("money-spaces.csv", {
    buffer: csvBuffer(
      MONEY_SPACE_COLUMNS,
      moneySpaces.map((row) => ({
        created_at: row.createdAt,
        id: row.id,
        name: row.name,
        revision: row.revision,
        status: row.status,
        updated_at: row.updatedAt,
      })),
    ),
    records: moneySpaces.length,
  });
  payloads.set("money-memos.json", {
    buffer: jsonBuffer({ records: moneyMemos, schemaVersion: EXPORT_SCHEMA_VERSION }),
    records: moneyMemos.length,
  });
  payloads.set("money-memos.csv", {
    buffer: csvBuffer(
      MEMO_COLUMNS,
      moneyMemos.map((row) => ({
        amount: row.amount,
        amount_minor: row.amountMinor,
        authoritative: row.authoritative,
        category_id: row.categoryId,
        created_at: row.createdAt,
        currency: row.currency,
        currency_exponent: row.currencyExponent,
        currency_registry_version: row.currencyRegistryVersion,
        direction: row.direction,
        id: row.id,
        lifecycle: row.lifecycle,
        money_space_id: row.moneySpaceId,
        note: row.note,
        occurred_at: row.occurredAt,
        occurred_local: row.occurredLocal,
        occurred_offset_minutes: row.occurredOffsetMinutes,
        occurred_timezone: row.occurredTimezone,
        origin: row.origin,
        planning_status: row.planningStatus,
        purpose: row.purpose,
        revision: row.revision,
        timezone_database_version: row.timezoneDatabaseVersion,
        updated_at: row.updatedAt,
      })),
    ),
    records: moneyMemos.length,
  });
  if (snapshot.includeRecoverableDrafts) {
    payloads.set("drafts.json", {
      buffer: jsonBuffer({ records: drafts, schemaVersion: EXPORT_SCHEMA_VERSION }),
      records: drafts.length,
    });
    payloads.set("drafts.csv", {
      buffer: csvBuffer(
        DRAFT_COLUMNS,
        drafts.map((row) => ({
          authoritative: row.authoritative,
          capture_started_at: row.captureStartedAt,
          capture_timezone: row.captureTimezone,
          expires_at: row.expiresAt,
          id: row.id,
          last_activity_at: row.lastActivityAt,
          origin: row.origin,
          revision: row.revision,
          source_completeness: row.sourceCompleteness,
          source_text: row.sourceText,
          status: row.status,
        })),
      ),
      records: drafts.length,
    });
  }
  payloads.set("lifecycle.json", {
    buffer: jsonBuffer({ records: lifecycle, schemaVersion: EXPORT_SCHEMA_VERSION }),
    records: lifecycle.length,
  });

  const descriptors = [...payloads.entries()]
    .map(([name, value]) => fileDescriptor(name, value.buffer, value.records))
    .sort((a, b) => compareText(a.name, b.name));
  const manifest: ExportManifestV1 = Object.freeze({
    accountId: snapshot.accountId,
    authoritativeRecordType: "money_memo",
    createdAt: snapshot.createdAt,
    csvCellEncoding: "rfc4180;dangerous-prefix-apostrophe",
    currencyRegistryVersions: [...new Set(snapshot.currencyRegistryVersions)].sort(compareText),
    exportId: snapshot.exportId,
    files: descriptors,
    includesRecoverableDrafts: snapshot.includeRecoverableDrafts,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    snapshotCutoff: snapshot.snapshotCutoff,
    timezoneSemantics: "instant+local+iana-zone+offset",
    valueEncoding: "money-decimal-and-minor-units-as-strings; no conversion",
  });
  const manifestBuffer = jsonBuffer(manifest);
  const files = new Map<string, Buffer>(
    [...payloads.entries()].map(([name, value]) => [name, value.buffer] as const),
  );
  files.set("manifest.json", manifestBuffer);
  const orderedFiles = [...files.entries()].sort(([left], [right]) => compareText(left, right));
  const archive = deterministicZip(orderedFiles);
  return Object.freeze({
    archive,
    archiveSha256: sha256(archive),
    filename: `cashmemo-export-${snapshot.createdAt.slice(0, 10)}.zip`,
    files: new Map(orderedFiles),
    manifest,
    manifestSha256: sha256(manifestBuffer),
  });
}

export {
  CSV_FORMULA_PROTECTION,
  EXPORT_SCHEMA_VERSION,
  protectCsvFormula,
  serializeExportV1,
  stableJsonValue,
  type ExportCategory,
  type ExportDraft,
  type ExportLifecycleEntry,
  type ExportManifestV1,
  type ExportMoneyMemo,
  type ExportMoneySpace,
  type ExportPreference,
  type ExportV1Snapshot,
  type SerializedExportV1,
};
