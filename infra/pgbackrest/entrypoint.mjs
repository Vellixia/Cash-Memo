import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const failSafely = (error) => {
  const message = error instanceof Error ? error.message : "";
  const code = /^PGBACKREST_[A-Z_]+(?::[A-Z0-9_]+)?$/u.test(message)
    ? message
    : "PGBACKREST_CONFIGURATION_FAILED";
  process.stderr.write(`${code}\n`);
  process.exit(1);
};
process.once("uncaughtException", failSafely);
process.once("unhandledRejection", failSafely);

const mode = process.argv[2] ?? "version";
const allowedModes = new Set([
  "archive-check",
  "archive-push",
  "backup-diff",
  "backup-full",
  "check",
  "expire",
  "health",
  "info",
  "pitr-restore",
  "restore",
  "stanza-create",
  "version",
]);

if (!allowedModes.has(mode)) {
  process.stderr.write("PGBACKREST_MODE_INVALID\n");
  process.exit(64);
}

const required = (name) => {
  const value = process.env[name];
  if (value === undefined || value === "" || /[\r\n\0]/u.test(value)) {
    throw new Error(`PGBACKREST_CONFIG_NAME_INVALID:${name}`);
  }
  return value;
};

const stanza = process.env.PGBACKREST_STANZA ?? "cashmemo";
if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(stanza)) throw new Error("PGBACKREST_STANZA_INVALID");

const baseArguments = [];
if (mode !== "version") {
  const endpoint = new URL(required("RUSTFS_SECONDARY_ENDPOINT"));
  if (!new Set(["http:", "https:"]).has(endpoint.protocol) || endpoint.pathname !== "/") {
    throw new Error("PGBACKREST_STORAGE_ENDPOINT_INVALID");
  }
  const bucket = required("PGBACKREST_REPOSITORY_BUCKET");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket)) {
    throw new Error("PGBACKREST_REPOSITORY_BUCKET_INVALID");
  }
  const prefix = required("PGBACKREST_REPOSITORY_PREFIX");
  if (!/^[a-z0-9][a-z0-9/_-]{0,127}$/u.test(prefix)) {
    throw new Error("PGBACKREST_REPOSITORY_PREFIX_INVALID");
  }
  const pgPath = process.env.PGBACKREST_PG1_PATH ?? "/var/lib/postgresql/18/docker";
  if (!pgPath.startsWith("/") || /[\r\n\0]/u.test(pgPath)) {
    throw new Error("PGBACKREST_PG1_PATH_INVALID");
  }

  process.env.PGBACKREST_REPO1_S3_KEY = required("RUSTFS_SECONDARY_ACCESS_KEY");
  process.env.PGBACKREST_REPO1_S3_KEY_SECRET = required("RUSTFS_SECONDARY_SECRET_KEY");
  process.env.PGBACKREST_REPO1_CIPHER_PASS = required("PGBACKREST_REPOSITORY_CIPHER_PASS");

  const config = [
    "[global]",
    "repo1-type=s3",
    `repo1-s3-endpoint=${endpoint.hostname}`,
    `repo1-s3-bucket=${bucket}`,
    `repo1-s3-region=${required("RUSTFS_SECONDARY_REGION")}`,
    "repo1-s3-uri-style=path",
    `repo1-path=/${prefix}`,
    `repo1-storage-port=${endpoint.port || (endpoint.protocol === "https:" ? "443" : "80")}`,
    `repo1-storage-verify-tls=${endpoint.protocol === "https:" ? "y" : "n"}`,
    "repo1-cipher-type=aes-256-cbc",
    "repo1-retention-full=5",
    "repo1-retention-diff=14",
    "archive-async=y",
    "spool-path=/var/spool/pgbackrest",
    "start-fast=y",
    "process-max=2",
    "log-level-console=info",
    "log-level-file=off",
    "",
    `[${stanza}]`,
    `pg1-path=${pgPath}`,
    "pg1-port=5432",
    "pg1-socket-path=/var/run/postgresql",
    "",
  ].join("\n");
  await writeFile("/tmp/pgbackrest.conf", config, { encoding: "utf8", mode: 0o600 });
  baseArguments.push("--config=/tmp/pgbackrest.conf", `--stanza=${stanza}`);
}

const commands = {
  "archive-check": [...baseArguments, "check"],
  "backup-diff": [...baseArguments, "--type=diff", "backup"],
  "backup-full": [...baseArguments, "--type=full", "backup"],
  check: [...baseArguments, "check"],
  expire: [...baseArguments, "expire"],
  health: [...baseArguments, "check"],
  info: [...baseArguments, "--output=json", "info"],
  restore: [...baseArguments, "--delta", "restore"],
  "stanza-create": [...baseArguments, "stanza-create"],
  version: ["version"],
};

if (mode === "archive-push") {
  const walPath = process.argv[3];
  if (!walPath || !walPath.startsWith("/") || /[\r\n\0]/u.test(walPath)) {
    throw new Error("PGBACKREST_WAL_PATH_INVALID");
  }
  commands[mode] = [...baseArguments, "archive-push", walPath];
}

if (mode === "pitr-restore") {
  const target = required("PGBACKREST_TARGET_TIME");
  if (Number.isNaN(Date.parse(target))) throw new Error("PGBACKREST_TARGET_TIME_INVALID");
  commands[mode] = [
    ...baseArguments,
    "--delta",
    "--type=time",
    `--target=${target}`,
    "--target-action=promote",
    "restore",
  ];
}

const child = spawn("/usr/local/bin/pgbackrest", commands[mode], {
  env: process.env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", () => {
  process.stderr.write("PGBACKREST_EXEC_FAILED\n");
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
