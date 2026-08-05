import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const allowedFiles = new Map([
  ["package-lock.json", "dependency registry integrity metadata"],
  ["backend/Cargo.lock", "dependency registry checksums"],
  ["tests/integration-appwrite/Cargo.lock", "dependency registry checksums"],
  [
    "tests/privacy/fixtures/canaries.json",
    "synthetic privacy canaries required by the disclosure scanner",
  ],
]);

const listed = spawnSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "buffer" },
);
if (listed.status !== 0)
  throw new Error("unable to enumerate repository files");

const paths = listed.stdout.toString("utf8").split("\0").filter(Boolean);
let failures = 0;

for (const path of paths) {
  if (allowedFiles.has(path)) continue;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  for (const [lineIndex, line] of text.split("\n").entries()) {
    const tokens = line.match(/[A-Za-z0-9_+/=-]{32,}/gu) ?? [];
    for (const token of tokens) {
      if (isReviewedNonSecret(path, token, line)) continue;
      if (shannon(token) < threshold(token)) continue;
      process.stderr.write(
        `${path}:${lineIndex + 1}: high-entropy credential candidate (length ${token.length}); value suppressed\n`,
      );
      failures += 1;
    }
  }
}

if (failures > 0) process.exitCode = 1;
else
  process.stdout.write(
    "high-entropy scan passed with narrow reviewed allowlists\n",
  );

function threshold(token) {
  return /^[0-9a-f]+$/iu.test(token) ? 3.6 : 4.35;
}

function shannon(value) {
  const counts = new Map();
  for (const character of value)
    counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isReviewedNonSecret(path, token, line) {
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(token)) return true;
  if (!/[0-9]/u.test(token)) return true;
  if (line.includes("sha256:") || line.includes("sourceSha256")) return true;
  if (line.includes("REGISTRY_SHA256") || line.includes("expected ="))
    return true;
  if (line.includes("github.com/")) return true;
  if (/^\.specify\/integrations\/.+\.manifest\.json$/u.test(path)) return true;
  if (path === ".specify/memory/.constitution-template.json") return true;
  if (
    path === "scripts/currencies/build-registry.mjs" ||
    path === "specs/001-money-memo-foundation/contracts/currencies-v1.md" ||
    path === "scripts/contracts/validate-pattern-set.mjs" ||
    path === "tests/contracts/currency_registry.test.mjs"
  )
    return true;
  if (
    path === "backend/crates/http-adapter/src/contracts/generated.rs" &&
    /^[0-9a-f]{64}$/u.test(token)
  )
    return true;
  return false;
}
