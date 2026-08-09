import { spawn } from "node:child_process";

async function run(command, arguments_, environment = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) return reject(new Error(`DATABASE_VERIFICATION_SIGNAL:${signal}`));
      if (code !== 0) return reject(new Error(`DATABASE_VERIFICATION_EXIT:${code ?? "unknown"}`));
      resolve();
    });
  });
}

try {
  await run(
    "pnpm",
    [
      "--filter",
      "@cashmemo/server",
      "exec",
      "vitest",
      "run",
      "tests/integration/migrations.spec.ts",
    ],
    { ...process.env, CASHMEMO_DATABASE_VERIFICATION: "1" },
  );
  await run("pnpm", ["exec", "tsx", "apps/server/tests/integration/write-database-evidence.ts"]);
} catch (error) {
  console.error(error instanceof Error ? error.message : "DATABASE_VERIFICATION_FAILED");
  process.exitCode = 1;
}
