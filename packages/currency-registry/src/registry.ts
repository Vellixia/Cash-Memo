import registryData from "../data/registry-v1.json" with { type: "json" };

const forbiddenKey = /(?:conversion|exchange|rate)/iu;
const currencyCodePattern = /^[A-Z]{3}$/u;

interface CurrencyRegistryEntry {
  readonly code: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly exponent: 0 | 1 | 2 | 3;
  readonly symbol: string;
}

interface CurrencySourceReference {
  readonly published?: string;
  readonly release?: string;
  readonly sha256: string;
  readonly url: string;
}

interface CurrencyRegistrySource {
  readonly cldrEnglish: CurrencySourceReference;
  readonly cldrIndonesian: CurrencySourceReference;
  readonly cldrSupplemental: CurrencySourceReference;
  readonly iso4217: CurrencySourceReference;
}

class CurrencyRegistryValidationError extends Error {
  constructor() {
    super("Currency registry validation failed.");
    this.name = "CurrencyRegistryValidationError";
  }
}

class CurrencyRegistry {
  readonly entries: readonly CurrencyRegistryEntry[];
  readonly reviewedAt: string;
  readonly sources: CurrencyRegistrySource;
  readonly version: string;
  readonly #byCode: ReadonlyMap<string, CurrencyRegistryEntry>;

  constructor(candidate: unknown) {
    rejectForbiddenKeys(candidate);
    const root = exactObject(candidate, [
      "currencies",
      "registryVersion",
      "reviewedAt",
      "schemaVersion",
      "sources",
    ]);
    if (root["schemaVersion"] !== "1") throw new CurrencyRegistryValidationError();
    if (typeof root["registryVersion"] !== "string" || root["registryVersion"].length === 0) {
      throw new CurrencyRegistryValidationError();
    }
    if (
      typeof root["reviewedAt"] !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(root["reviewedAt"])
    ) {
      throw new CurrencyRegistryValidationError();
    }

    const entries = currencyEntries(root["currencies"]);
    const byCode = new Map(entries.map((entry) => [entry.code, entry]));
    if (byCode.size !== entries.length) throw new CurrencyRegistryValidationError();

    this.version = root["registryVersion"];
    this.reviewedAt = root["reviewedAt"];
    this.entries = Object.freeze(entries);
    this.sources = sourceReferences(root["sources"]);
    this.#byCode = byCode;
    Object.freeze(this);
  }

  get(code: unknown): CurrencyRegistryEntry | undefined {
    if (typeof code !== "string" || !currencyCodePattern.test(code)) return undefined;
    const entry = this.#byCode.get(code);
    return entry?.enabled === true ? entry : undefined;
  }
}

function exactObject(candidate: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new CurrencyRegistryValidationError();
  }
  const value = candidate as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.length !== allowedKeys.length || keys.some((key) => !allowedKeys.includes(key))) {
    throw new CurrencyRegistryValidationError();
  }
  return value;
}

function currencyEntries(candidate: unknown): CurrencyRegistryEntry[] {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new CurrencyRegistryValidationError();
  }
  const entries = candidate.map((value) => {
    const entry = exactObject(value, ["code", "displayName", "enabled", "exponent", "symbol"]);
    if (typeof entry["code"] !== "string" || !currencyCodePattern.test(entry["code"])) {
      throw new CurrencyRegistryValidationError();
    }
    if (![0, 1, 2, 3].includes(entry["exponent"] as number)) {
      throw new CurrencyRegistryValidationError();
    }
    if (
      entry["enabled"] !== true ||
      typeof entry["displayName"] !== "string" ||
      entry["displayName"].length === 0 ||
      typeof entry["symbol"] !== "string" ||
      entry["symbol"].length === 0
    ) {
      throw new CurrencyRegistryValidationError();
    }
    return Object.freeze({
      code: entry["code"],
      displayName: entry["displayName"],
      enabled: true,
      exponent: entry["exponent"] as 0 | 1 | 2 | 3,
      symbol: entry["symbol"],
    });
  });
  return entries.sort((left, right) => left.code.localeCompare(right.code));
}

function sourceReferences(candidate: unknown): CurrencyRegistrySource {
  const sources = exactObject(candidate, [
    "cldrEnglish",
    "cldrIndonesian",
    "cldrSupplemental",
    "iso4217",
  ]);
  const parseSource = (value: unknown): CurrencySourceReference => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new CurrencyRegistryValidationError();
    }
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source);
    if (
      keys.some((key) => !["published", "release", "sha256", "url"].includes(key)) ||
      typeof source["sha256"] !== "string" ||
      !/^[0-9a-f]{64}$/u.test(source["sha256"]) ||
      typeof source["url"] !== "string" ||
      !source["url"].startsWith("https://")
    ) {
      throw new CurrencyRegistryValidationError();
    }
    return Object.freeze({
      ...(typeof source["published"] === "string" ? { published: source["published"] } : {}),
      ...(typeof source["release"] === "string" ? { release: source["release"] } : {}),
      sha256: source["sha256"],
      url: source["url"],
    });
  };
  return Object.freeze({
    cldrEnglish: parseSource(sources["cldrEnglish"]),
    cldrIndonesian: parseSource(sources["cldrIndonesian"]),
    cldrSupplemental: parseSource(sources["cldrSupplemental"]),
    iso4217: parseSource(sources["iso4217"]),
  });
}

function rejectForbiddenKeys(candidate: unknown): void {
  if (Array.isArray(candidate)) {
    candidate.forEach(rejectForbiddenKeys);
    return;
  }
  if (typeof candidate !== "object" || candidate === null) return;
  for (const [key, value] of Object.entries(candidate)) {
    if (forbiddenKey.test(key)) throw new CurrencyRegistryValidationError();
    rejectForbiddenKeys(value);
  }
}

const currencyRegistryV1 = new CurrencyRegistry(registryData);

export {
  CurrencyRegistry,
  CurrencyRegistryValidationError,
  currencyRegistryV1,
  type CurrencyRegistryEntry,
  type CurrencyRegistrySource,
  type CurrencySourceReference,
};
