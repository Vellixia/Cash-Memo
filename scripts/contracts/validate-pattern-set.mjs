import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const registryPath = resolve("shared/privacy/pattern-set-v1.json");
const raw = readFileSync(registryPath);
const expected =
  "b26ada11eba9e97695b5aac1556131cd10c7b28099867d4db1721b5f969ef15d";
const actual = createHash("sha256").update(raw).digest("hex");
if (actual !== expected) {
  throw new Error(
    "Pattern Set v1 registry differs from the reviewed complete registry",
  );
}
const registry = JSON.parse(raw.toString("utf8"));
if (
  registry.version !== "pattern-set-v1" ||
  registry.blocking?.length !== 9 ||
  registry.warnings?.length !== 3 ||
  registry.blocking?.[7]?.id !== "B8_STATEMENT_PASTE" ||
  registry.blocking?.[7]?.transactionLinesMustFollowHeader !== true ||
  registry.blocking?.[7]?.amountToken !== "SEPARATE_ASCII_DIGIT_TOKEN"
) {
  throw new Error("Pattern Set v1 registry structure is incomplete");
}
process.stdout.write("Complete Pattern Set v1 registry validation passed\n");
