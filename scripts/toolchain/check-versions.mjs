import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const packageJson = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);

const actualNode = process.versions.node;
const actualPnpm = execFileSync("pnpm", ["--version"], {
  encoding: "utf8",
}).trim();

const expectedNode = packageJson.engines.node;
const expectedPnpm = packageJson.engines.pnpm;

if (actualNode !== expectedNode || actualPnpm !== expectedPnpm) {
  process.stderr.write(
    `Toolchain mismatch: node=${actualNode} (expected ${expectedNode}), pnpm=${actualPnpm} (expected ${expectedPnpm})\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Toolchain verified: node=${actualNode}, pnpm=${actualPnpm}\n`);
}
