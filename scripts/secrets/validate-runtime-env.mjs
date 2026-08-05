import { readFile, stat } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const basePath = "config/local-secrets/cashmemo.env";
const runtimePath = "config/local-secrets/appwrite-runtime.env";
const schema = JSON.parse(await readFile("config/env.schema.json", "utf8"));
const base = parse(await readFile(basePath, "utf8"));
const runtime = parse(await readFile(runtimePath, "utf8"));

for (const name of runtime.keys()) {
  if (base.has(name)) fail(`duplicate runtime name: ${name}`);
}
if (base.has("APPWRITE_SERVER_API_KEY"))
  fail("APPWRITE_SERVER_API_KEY must exist only in appwrite-runtime.env");
if (!runtime.has("APPWRITE_SERVER_API_KEY"))
  fail("APPWRITE_SERVER_API_KEY missing from appwrite-runtime.env");
for (const [path, metadata] of [
  [basePath, await stat(basePath)],
  [runtimePath, await stat(runtimePath)],
]) {
  if ((metadata.mode & 0o077) !== 0) fail(`${path} permissions must be 0600`);
}

const values = Object.fromEntries([...base, ...runtime]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addKeyword({ keyword: "secret", schemaType: "boolean", valid: true });
const validate = ajv.compile(schema);
if (!validate(values)) {
  for (const error of validate.errors ?? []) {
    process.stderr.write(
      `runtime configuration ${error.instancePath || "/"} ${error.message ?? error.keyword}\n`,
    );
  }
  process.exit(1);
}
process.stdout.write(
  "Runtime configuration validated with secret values suppressed and files mode 0600\n",
);

function parse(text) {
  const values = new Map();
  for (const line of text.split("\n")) {
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail("runtime configuration line malformed");
    const name = line.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name))
      fail("runtime configuration name malformed");
    if (values.has(name)) fail(`duplicate runtime name: ${name}`);
    values.set(name, line.slice(separator + 1));
  }
  return values;
}

function fail(message) {
  process.stderr.write(`${message}; values suppressed\n`);
  process.exit(1);
}
