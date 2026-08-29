import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

interface ProcessSummary {
  command: string;
  processed: number;
}

export interface GeneratedLinkage {
  rows: number;
  linkedRows: number;
  distinctOccurrences: number;
}

export function processRecurring(): ProcessSummary {
  const postgresPort = process.env.CASHMEMO_V1_E2E_POSTGRES_PORT ?? "54329";
  const databaseUrl =
    process.env.CASHMEMO_V1_E2E_DATABASE_URL ??
    `postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:${postgresPort}/cashmemo_e2e`;
  const args = [
    "run",
    "-p",
    "cashmemo-api",
    "--bin",
    "cashmemo-api",
    "--",
    "process-recurring",
    "--batch-size",
    "1",
    "--max-occurrences-per-recurring-transaction",
    "1",
  ];
  const result = spawnSync("cargo", args, {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
    env: {
      ...process.env,
      CASHMEMO_V1_APP_ENV: "test",
      CASHMEMO_V1_DATABASE_URL: databaseUrl,
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `process-recurring failed (status ${String(result.status)}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  const summary = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? "{}") as ProcessSummary;
  if (summary.command !== "process-recurring" || summary.processed !== 1) {
    throw new Error(`process-recurring generated unexpected summary: ${result.stdout}`);
  }
  console.info(
    `process-recurring: CASHMEMO_V1_APP_ENV=test CASHMEMO_V1_DATABASE_URL=${databaseUrl} cargo ${args.join(" ")} => ${JSON.stringify(summary)}`,
  );
  return summary;
}

export function inspectGeneratedLinkage(note: string): GeneratedLinkage {
  const escapedNote = note.replaceAll("'", "''");
  const query =
    `SELECT count(*)::text || '|' || count(recurring_occurrence_id)::text || ` +
    `'|' || count(DISTINCT recurring_occurrence_id)::text FROM transactions WHERE note = '${escapedNote}'`;
  const result = spawnSync(
    "docker",
    [
      "exec",
      process.env.CASHMEMO_V1_E2E_POSTGRES_CONTAINER ?? "v1-postgres-1",
      "psql",
      "-U",
      "cashmemo_e2e",
      "-d",
      "cashmemo_e2e",
      "-Atc",
      query,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `generated linkage query failed (status ${String(result.status)}):\n${result.stderr}`,
    );
  }
  const [rows, linkedRows, distinctOccurrences] = result.stdout.trim().split("|").map(Number);
  if (![rows, linkedRows, distinctOccurrences].every(Number.isInteger)) {
    throw new Error(`generated linkage query returned unexpected output: ${result.stdout}`);
  }
  return { rows, linkedRows, distinctOccurrences };
}
