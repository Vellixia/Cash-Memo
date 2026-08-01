import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { XMLParser } from "fast-xml-parser";

const PINNED_SHA256 =
  "838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9";
const VERSION = "iso4217-list-one-2026-01-01";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const inputPath = argument("--input");
const outputPath = argument(
  "--output",
  "shared/currencies/iso4217-list-one-2026-01-01.json",
);
const expectedSha = argument("--expected-sha", PINNED_SHA256);
if (!inputPath) throw new Error("--input is required");

const source = readFileSync(resolve(inputPath));
const digest = createHash("sha256").update(source).digest("hex");
if (digest !== expectedSha)
  throw new Error(
    `SIX source checksum mismatch: expected ${expectedSha}, received ${digest}`,
  );

const parsed = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
}).parse(source);
const rawEntries = parsed?.ISO_4217?.CcyTbl?.CcyNtry;
if (!Array.isArray(rawEntries))
  throw new Error("SIX XML does not contain ISO_4217/CcyTbl/CcyNtry entries");

const byCode = new Map();
for (const entry of rawEntries) {
  const code = typeof entry.Ccy === "string" ? entry.Ccy.trim() : "";
  const scaleText =
    typeof entry.CcyMnrUnts === "string" ? entry.CcyMnrUnts.trim() : "";
  if (!code || scaleText === "N.A." || !/^\d+$/.test(scaleText)) continue;
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`Invalid ISO code ${code}`);
  const minorUnitScale = Number(scaleText);
  if (
    !Number.isSafeInteger(minorUnitScale) ||
    minorUnitScale < 0 ||
    minorUnitScale > 4
  ) {
    throw new Error(`Unsupported minor-unit scale ${scaleText} for ${code}`);
  }
  const name =
    typeof entry.CcyNm === "string"
      ? entry.CcyNm.trim()
      : String(entry.CcyNm?.["#text"] ?? "").trim();
  const existing = byCode.get(code);
  if (
    existing &&
    (existing.minorUnitScale !== minorUnitScale || existing.name !== name)
  ) {
    throw new Error(`Duplicate currency disagreement for ${code}`);
  }
  byCode.set(code, { code, name, minorUnitScale });
}

const currencies = [...byCode.values()].sort((left, right) =>
  left.code.localeCompare(right.code),
);
if (currencies.length === 0)
  throw new Error("Currency registry would be empty");

writeFileSync(
  resolve(outputPath),
  `${JSON.stringify({ version: VERSION, sourceEffectiveDate: "2026-01-01", sourceSha256: digest, currencies }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o644 },
);
process.stdout.write(`Generated ${currencies.length} currencies\n`);
