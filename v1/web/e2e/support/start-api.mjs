import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(webRoot, "../..");
const composeFile = path.join(repositoryRoot, "infra/v1/test-compose.yml");
const postgresPort = process.env.CASHMEMO_V1_E2E_POSTGRES_PORT ?? "54329";
const publicOrigin = process.env.CASHMEMO_V1_E2E_PUBLIC_ORIGIN ?? "http://localhost:3000";
const apiEnvironment = {
  ...process.env,
  CASHMEMO_V1_APP_ENV: "test",
  CASHMEMO_V1_DATABASE_URL:
    process.env.CASHMEMO_V1_E2E_DATABASE_URL ??
    `postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:${postgresPort}/cashmemo_e2e`,
  CASHMEMO_V1_BIND_ADDR: "127.0.0.1:3001",
  CASHMEMO_V1_PUBLIC_ORIGIN: publicOrigin,
  CASHMEMO_V1_ALLOWED_ORIGINS: publicOrigin,
  CASHMEMO_V1_SMTP_HOST: "127.0.0.1",
  CASHMEMO_V1_SMTP_PORT: process.env.CASHMEMO_V1_E2E_SMTP_PORT ?? "1025",
  CASHMEMO_V1_SMTP_FROM: "Cashmemo E2E <cashmemo-e2e@example.test>",
  CASHMEMO_V1_SMTP_SECURITY: "plaintext",
  CASHMEMO_V1_AUTH_REGISTER_LIMIT: "100",
  CASHMEMO_V1_AUTH_VERIFICATION_RESEND_LIMIT: "100",
  CASHMEMO_V1_AUTH_LOGIN_LIMIT: "100",
  CASHMEMO_V1_AUTH_RESET_REQUEST_LIMIT: "100",
};

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

const migrate = spawnSync("cargo", ["run", "-p", "cashmemo-api", "--", "migrate"], {
  cwd: repositoryRoot,
  env: apiEnvironment,
  stdio: "inherit",
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const api = spawn("cargo", ["run", "-p", "cashmemo-api", "--", "serve"], {
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
