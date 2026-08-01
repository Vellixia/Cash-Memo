import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaPath = resolve(
  "specs/001-money-memo-foundation/contracts/export-v1.schema.json",
);
const raw = readFileSync(schemaPath, "utf8");
const schema = JSON.parse(raw);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function invariant(condition, message) {
  if (!condition) throw new Error(`Export schema violation: ${message}`);
}

function assertClosedObjects(value, path = "#") {
  if (value === null || typeof value !== "object") return;
  if (value.type === "object")
    invariant(value.additionalProperties === false, `${path} must be closed`);
  for (const [key, child] of Object.entries(value))
    assertClosedObjects(child, `${path}/${key}`);
}

const amount = schema.$defs.amount;
const expectedPatterns = [
  "^(0|[1-9]\\d*)$",
  "^(0|[1-9]\\d*)\\.\\d{1}$",
  "^(0|[1-9]\\d*)\\.\\d{2}$",
  "^(0|[1-9]\\d*)\\.\\d{3}$",
  "^(0|[1-9]\\d*)\\.\\d{4}$",
];
invariant(amount.allOf.length === 5, "exact scale branches 0-4 required");
for (const [scale, branch] of amount.allOf.entries()) {
  invariant(
    branch.if.properties.minorUnitScale.const === scale,
    `scale branch ${scale} selector drifted`,
  );
  invariant(
    branch.then.properties.decimal.pattern === expectedPatterns[scale],
    `scale branch ${scale} pattern drifted`,
  );
}
invariant(
  raw.endsWith("\n") && !raw.endsWith("\n\n"),
  "must end with exactly one LF",
);
assertClosedObjects(schema);

function sample(
  decimal,
  scale,
  instant = "2026-07-30T12:15:00.000000Z",
  offset = "+07:00",
) {
  return {
    format: "cashmemo.money-memos",
    formatVersion: 1,
    acceptedAt: instant,
    includeArchived: false,
    currencyRegistry: "iso4217-list-one-2026-01-01",
    references: { categories: [], moneySpaces: [] },
    moneyMemos: [
      {
        id: "0198a71a-3d39-7d4b-8eab-0e3c0f17be28",
        type: "expense",
        amount: { decimal, currency: "USD", minorUnitScale: scale },
        occurrence: {
          instant,
          localWallTime: "2026-07-30T19:15:00.000000",
          utcOffset: offset,
        },
        categoryId: "0198a71a-3d39-7d4b-8eab-0e3c0f17be29",
        moneySpaceId: "0198a71a-3d39-7d4b-8eab-0e3c0f17be30",
        note: null,
        plannedStatus: "unplanned",
        purpose: "personal",
        lifecycleStatus: "active",
        createdAt: instant,
        updatedAt: instant,
      },
    ],
  };
}

for (let scale = 0; scale <= 4; scale += 1) {
  const exact = scale === 0 ? "42" : `42.${"0".repeat(scale)}`;
  invariant(
    validate(sample(exact, scale)),
    `scale ${scale} exact value rejected: ${ajv.errorsText(validate.errors)}`,
  );
  if (scale > 0) {
    invariant(
      !validate(
        sample(scale === 1 ? "42" : `42.${"0".repeat(scale - 1)}`, scale),
      ),
      `scale ${scale} too-few digits accepted`,
    );
  }
  invariant(
    !validate(sample(`${exact}${scale === 0 ? ".0" : "0"}`, scale)),
    `scale ${scale} too-many digits accepted`,
  );
}

invariant(
  validate(sample("42.00", 2, "2026-07-30T12:15:00.000000Z", "+14:00")),
  "+14:00 rejected",
);
invariant(
  validate(sample("42.00", 2, "2026-07-30T12:15:00.000000Z", "-14:00")),
  "-14:00 rejected",
);
for (const offset of ["+14:01", "+14:59", "-14:01", "-14:59"]) {
  invariant(
    !validate(sample("42.00", 2, "2026-07-30T12:15:00.000000Z", offset)),
    `${offset} accepted`,
  );
}
for (const instant of [
  "2026-07-30T12:15:00Z",
  "2026-07-30T12:15:00.000Z",
  "2026-07-30T12:15:00.000000+00:00",
]) {
  invariant(
    !validate(sample("42.00", 2, instant)),
    `noncanonical instant accepted: ${instant}`,
  );
}

process.stdout.write("Export JSON Schema 2020-12 checks passed\n");
