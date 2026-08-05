import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { parse } from "yaml";

const contractPath = resolve(
  "specs/001-money-memo-foundation/contracts/openapi.yaml",
);
const raw = readFileSync(contractPath, "utf8");
const api = parse(raw);

function invariant(condition, message) {
  if (!condition) throw new Error(`OpenAPI contract violation: ${message}`);
}

function pointer(root, path) {
  return path
    .split("/")
    .filter(Boolean)
    .reduce((value, key) => value?.[key], root);
}

function assertClosedObjects(value, path = "#") {
  if (value === null || typeof value !== "object") return;
  if (value.type === "object") {
    invariant(
      value.additionalProperties === false,
      `${path} must set additionalProperties: false`,
    );
  }
  for (const [key, child] of Object.entries(value))
    assertClosedObjects(child, `${path}/${key}`);
}

function operations(document) {
  const result = new Map();
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      if (item[method])
        result.set(`${method.toUpperCase()} ${path}`, item[method]);
    }
  }
  return result;
}

function assertNonBreaking(baseline, current) {
  if (baseline.contract === "cashmemo-openapi-v1") {
    const next = operations(current);
    for (const [operation, statuses] of Object.entries(baseline.operations)) {
      invariant(next.has(operation), `breaking removal of ${operation}`);
      const responses = next.get(operation).responses ?? {};
      for (const status of statuses)
        invariant(
          status in responses,
          `breaking response removal ${operation} ${status}`,
        );
    }
    for (const [name, schema] of Object.entries(baseline.schemas)) {
      const currentSchema = current.components?.schemas?.[name];
      invariant(currentSchema, `breaking schema removal ${name}`);
      for (const required of schema.required ?? [])
        invariant(
          currentSchema.required?.includes(required),
          `breaking required-property removal ${name}.${required}`,
        );
      for (const member of schema.enum ?? [])
        invariant(
          currentSchema.enum?.includes(member),
          `breaking enum removal ${name}.${member}`,
        );
    }
    return;
  }
  const previous = operations(baseline);
  const next = operations(current);
  for (const [operation, oldValue] of previous) {
    invariant(next.has(operation), `breaking removal of ${operation}`);
    const nextResponses = next.get(operation).responses ?? {};
    for (const status of Object.keys(oldValue.responses ?? {})) {
      invariant(
        status in nextResponses,
        `breaking response removal ${operation} ${status}`,
      );
    }
  }
  for (const [name, schema] of Object.entries(
    baseline.components?.schemas ?? {},
  )) {
    const currentSchema = current.components?.schemas?.[name];
    invariant(currentSchema, `breaking schema removal ${name}`);
    for (const required of schema.required ?? []) {
      invariant(
        currentSchema.required?.includes(required),
        `breaking required-property removal ${name}.${required}`,
      );
    }
    if (schema.enum) {
      for (const member of schema.enum)
        invariant(
          currentSchema.enum?.includes(member),
          `breaking enum removal ${name}.${member}`,
        );
    }
  }
}

invariant(api.openapi === "3.1.0", "must use OpenAPI 3.1.0");
invariant(
  raw.endsWith("\n") && !raw.endsWith("\n\n"),
  "must end with exactly one LF",
);
assertClosedObjects(api);

const schemas = api.components.schemas;
invariant(
  schemas.CanonicalUtcInstant.pattern ===
    "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$",
  "canonical UTC pattern drifted",
);
invariant(
  schemas.UtcOffset.pattern === "^(?:[+-](?:0\\d|1[0-3]):[0-5]\\d|[+-]14:00)$",
  "UTC offset boundary drifted",
);
invariant(
  schemas.MoneyMemo.required.includes("purgeDeadline"),
  "MoneyMemo.purgeDeadline must be required",
);
invariant(
  schemas.MoneyMemo.allOf?.length === 1,
  "MoneyMemo purgeDeadline lifecycle condition missing",
);
invariant(
  schemas.ErrorResponse.properties.code.enum.includes("PRIVACY_INPUT_REJECTED"),
  "privacy error code missing",
);
invariant(
  JSON.stringify(schemas.SafeDetectorId.enum) ===
    JSON.stringify([
      "B1_PAN_LUHN",
      "B2_IBAN_MOD97",
      "B3_LABELED_ACCOUNT",
      "B4_LABELED_ROUTING",
      "B5_LABELED_CARD_SECRET",
      "B6_LABELED_BANK_CREDENTIAL",
      "B7_LABELED_BANK_TOKEN",
      "B8_STATEMENT_PASTE",
      "B9_LABELED_GOV_ID",
    ]),
  "safe detector allowlist drifted",
);
invariant(
  !raw.match(/ownerId|owner_id/),
  "public contract must not expose owner fields",
);
invariant(
  pointer(
    api,
    "/paths/~1v1~1exports~1money-memos/post/responses/200/content",
  ) === undefined ||
    Object.hasOwn(
      api.paths["/v1/exports/money-memos"].post.responses["200"].content,
      "application/vnd.cashmemo.money-memo-export+json;version=1",
    ),
  "export MIME drifted",
);

const baselineArg = process.argv.indexOf("--against");
if (baselineArg >= 0) {
  const baselinePath = process.argv[baselineArg + 1];
  invariant(baselinePath, "--against requires a baseline path");
  const baselineRaw = readFileSync(resolve(baselinePath), "utf8");
  const baseline = baselinePath.endsWith(".json")
    ? JSON.parse(baselineRaw)
    : parse(baselineRaw);
  assertNonBreaking(baseline, api);
}

process.stdout.write("OpenAPI semantic contract checks passed\n");
