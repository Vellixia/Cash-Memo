import { readFile } from "node:fs/promises";

const [manifestPath] = process.argv.slice(2);
if (!manifestPath) {
  process.stderr.write("DEPLOYMENT_COMPATIBILITY_INPUT_REQUIRED\n");
  process.exit(2);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const allowedKeys = new Set([
  "currentSchema",
  "previousImageSchemaMin",
  "previousImageSchemaMax",
  "forwardFixAvailable",
  "incidentId",
]);
if (Object.keys(manifest).some((key) => !allowedKeys.has(key)))
  throw new Error("DEPLOYMENT_COMPATIBILITY_SCHEMA_INVALID");
for (const key of ["currentSchema", "previousImageSchemaMin", "previousImageSchemaMax"]) {
  if (!Number.isSafeInteger(manifest[key]) || manifest[key] < 0)
    throw new Error("DEPLOYMENT_COMPATIBILITY_SCHEMA_INVALID");
}
if (
  typeof manifest.forwardFixAvailable !== "boolean" ||
  !/^[A-Z0-9_-]{3,64}$/u.test(manifest.incidentId)
)
  throw new Error("DEPLOYMENT_COMPATIBILITY_SCHEMA_INVALID");

let decision;
if (
  manifest.currentSchema >= manifest.previousImageSchemaMin &&
  manifest.currentSchema <= manifest.previousImageSchemaMax
) {
  decision = "ROLLBACK_SAFE";
} else if (manifest.forwardFixAvailable) {
  decision = "SAFE_FORWARD_REQUIRED";
} else {
  decision = "BLOCKED_MANUAL_ESCALATION";
}

process.stdout.write(`DEPLOYMENT_DECISION=${decision} incident=${manifest.incidentId}\n`);
if (decision === "BLOCKED_MANUAL_ESCALATION") process.exitCode = 2;
