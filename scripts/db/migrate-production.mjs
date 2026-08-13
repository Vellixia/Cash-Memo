import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "pg";

const SAFE_LOCK_ID = 730_021_228;
const migrationDirectory = resolve(
  import.meta.dirname,
  "../../apps/server/src/adapters/postgres/migrations",
);
const buildVersion = process.env.BUILD_VERSION;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("MIGRATION_DATABASE_UNAVAILABLE");
if (!buildVersion || !/^[0-9a-f]{40}$/u.test(buildVersion))
  throw new Error("MIGRATION_BUILD_ID_INVALID");

const digest = (value) => createHash("sha256").update(value).digest("hex");
const client = new Client({
  connectionString: databaseUrl,
  application_name: `cashmemo-migration-${buildVersion.slice(0, 12)}`,
});

async function main() {
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [SAFE_LOCK_ID]);
  try {
    await client.query("SET lock_timeout = '10s'");
    await client.query("SET statement_timeout = '15min'");
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      checksum_sha256 TEXT,
      release_id TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query("ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT");
    await client.query("ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS release_id TEXT");

    const files = (await readdir(migrationDirectory))
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
      .sort();
    if (files.at(-1) !== "0005_search_projection.sql") throw new Error("MIGRATION_SET_UNEXPECTED");
    const applied = new Map(
      (
        await client.query("SELECT filename, checksum_sha256 FROM _migrations ORDER BY filename")
      ).rows.map((row) => [row.filename, row.checksum_sha256]),
    );
    let appliedCount = 0;
    const checksumBackfills = [];

    for (const filename of files) {
      const sql = await readFile(resolve(migrationDirectory, filename), "utf8");
      const checksum = digest(sql);
      const priorChecksum = applied.get(filename);
      if (priorChecksum && priorChecksum !== checksum)
        throw new Error("MIGRATION_CHECKSUM_MISMATCH");
      if (applied.has(filename)) {
        if (!priorChecksum) checksumBackfills.push([filename, checksum]);
        continue;
      }

      await client.query("BEGIN");
      try {
        for (const statement of sql.split("--> statement-breakpoint")) {
          if (statement.trim()) await client.query(statement);
        }
        await client.query(
          `INSERT INTO _migrations (filename, checksum_sha256, release_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (filename) DO UPDATE SET
             checksum_sha256 = COALESCE(_migrations.checksum_sha256, EXCLUDED.checksum_sha256),
             release_id = COALESCE(_migrations.release_id, EXCLUDED.release_id)`,
          [filename, checksum, buildVersion],
        );
        await client.query("COMMIT");
        appliedCount += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const verification = await client.query(`SELECT
      to_regclass('public.money_memos') IS NOT NULL AS memos,
      to_regclass('public.history_list_state') IS NOT NULL AS traversal,
      to_regclass('public.money_memos_search_vector_idx') IS NOT NULL AS search_index`);
    if (!Object.values(verification.rows[0]).every(Boolean))
      throw new Error("MIGRATION_SCHEMA_INCOMPATIBLE");
    if (checksumBackfills.length > 0) {
      await client.query("BEGIN");
      try {
        for (const [filename, checksum] of checksumBackfills) {
          await client.query(
            `UPDATE _migrations
             SET checksum_sha256 = $2, release_id = COALESCE(release_id, $3)
             WHERE filename = $1 AND checksum_sha256 IS NULL`,
            [filename, checksum, buildVersion],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    const setDigest = digest(files.join("\n"));
    process.stdout.write(
      `MIGRATION_RESULT=PASS release=${buildVersion} applied=${appliedCount} set_sha256=${setDigest}\n`,
    );
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SAFE_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  const code = new Set([
    "MIGRATION_BUILD_ID_INVALID",
    "MIGRATION_CHECKSUM_MISMATCH",
    "MIGRATION_DATABASE_UNAVAILABLE",
    "MIGRATION_SCHEMA_INCOMPATIBLE",
    "MIGRATION_SET_UNEXPECTED",
  ]).has(message)
    ? message
    : "MIGRATION_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
