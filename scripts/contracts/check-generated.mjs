import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "cashmemo-contract-"));
const generated = join(directory, "generated.ts");
try {
  const result = spawnSync(
    process.execPath,
    [
      resolve("node_modules/openapi-typescript/bin/cli.js"),
      resolve("specs/001-money-memo-foundation/contracts/openapi.yaml"),
      "-o",
      generated,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error("OpenAPI TypeScript generation failed");
  const committed = readFileSync(
    resolve("apps/web/src/lib/api/generated.ts"),
    "utf8",
  );
  const fresh = readFileSync(generated, "utf8");
  if (committed !== fresh)
    throw new Error("generated TypeScript API contract drifted");
  process.stdout.write("Generated TypeScript contract is current\n");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
