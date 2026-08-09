import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@hey-api/openapi-ts";

import codegenConfig from "../../packages/contracts/openapi-codegen.config.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const committedOutput = path.join(repositoryRoot, "packages/contracts/src/generated");

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function files(root, current = root) {
  const result = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...(await files(root, target)));
    if (entry.isFile()) result.push(path.relative(root, target));
  }
  return result.sort();
}

async function digest(target) {
  return createHash("sha256")
    .update(await readFile(target))
    .digest("hex");
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "cashmemo-contracts-"));
const expectedPrefix = path.join(tmpdir(), "cashmemo-contracts-");
if (!temporaryRoot.startsWith(expectedPrefix)) throw new Error("Unexpected temporary path");
try {
  const temporaryOutput = path.join(temporaryRoot, "generated");
  await createClient({
    ...codegenConfig,
    output: {
      ...codegenConfig.output,
      path: temporaryOutput,
    },
  });

  if (!(await exists(committedOutput))) {
    console.error("CONTRACT_DRIFT=BLOCKED reason=generated-output-missing");
    process.exitCode = 1;
  } else {
    const committedFiles = await files(committedOutput);
    const generatedFiles = await files(temporaryOutput);
    const changed = [];
    for (const file of new Set([...committedFiles, ...generatedFiles])) {
      const committed = path.join(committedOutput, file);
      const generated = path.join(temporaryOutput, file);
      if (!(await exists(committed)) || !(await exists(generated))) {
        changed.push(file);
        continue;
      }
      if ((await digest(committed)) !== (await digest(generated))) changed.push(file);
    }

    if (changed.length > 0) {
      console.error("CONTRACT_DRIFT=BLOCKED");
      for (const file of changed.sort()) console.error(`CONTRACT_DRIFT_FILE=${file}`);
      process.exitCode = 1;
    } else {
      console.log(`CONTRACT_DRIFT=PASS files=${committedFiles.length}`);
    }
  }
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
