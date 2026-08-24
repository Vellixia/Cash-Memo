import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cashmemoApiCommand } from "./commands.mjs";
import { buildE2eApiEnvironment } from "./api-environment.mjs";
import { PUBLIC_ORIGIN } from "./environment.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(webRoot, "../..");
const composeFile = path.join(repositoryRoot, "infra/v1/test-compose.yml");
const postgresPort = process.env.CASHMEMO_V1_E2E_POSTGRES_PORT ?? "54329";
const apiEnvironment = buildE2eApiEnvironment(process.env, {
  databaseUrl:
    process.env.CASHMEMO_V1_E2E_DATABASE_URL ??
    `postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:${postgresPort}/cashmemo_e2e`,
  publicOrigin: PUBLIC_ORIGIN,
  smtpPort: process.env.CASHMEMO_V1_E2E_SMTP_PORT ?? "1025",
});

const hasComposePlugin =
  spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
const compose = spawnSync(
  hasComposePlugin ? "docker" : "docker-compose",
  [
    ...(hasComposePlugin ? ["compose"] : []),
    "-f",
    composeFile,
    "up",
    "-d",
    "--wait",
    "postgres",
    "mailpit",
  ],
  { cwd: repositoryRoot, env: process.env, stdio: "inherit" },
);
if (compose.status !== 0) process.exit(compose.status ?? 1);

const migrateCommand = cashmemoApiCommand("migrate");
const migrate = spawnSync(migrateCommand.executable, migrateCommand.args, {
  cwd: repositoryRoot,
  env: apiEnvironment,
  stdio: "inherit",
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const serveCommand = cashmemoApiCommand("serve");
const api = spawn(serveCommand.executable, serveCommand.args, {
  cwd: repositoryRoot,
  env: apiEnvironment,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => api.kill(signal));
}
api.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
