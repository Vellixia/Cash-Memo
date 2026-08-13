import { spawnSync } from "node:child_process";

if (
  process.env["CASHMEMO_ALLOW_EXTERNAL_TEST_DATABASE"] !== "1" ||
  process.env["CASHMEMO_EXTERNAL_TEST_DATABASE_URL"] === undefined
) {
  process.stderr.write("PHASE15_REMOTE_DATABASE_NOT_AUTHORIZED\n");
  process.exit(2);
}

const gates = [
  ["build"],
  ["test:auth:better-auth-compat"],
  ["test:contract"],
  ["test:privacy"],
  ["test:security"],
  ["test:operations"],
];

for (const args of gates) {
  const result = spawnSync("corepack", ["pnpm", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.stderr.write(`PHASE15_REMOTE_GATE=FAIL gate=${args[0]}\n`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("PHASE15_REMOTE_GATE=PASS database=dokploy content=synthetic\n");
