import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { Pool } from "pg";

const migrationDir = resolve(
  import.meta.dirname,
  "../../apps/server/src/adapters/postgres/migrations",
);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    );

    const applied = new Set(
      (await pool.query("SELECT filename FROM _migrations ORDER BY filename")).rows.map(
        (r) => r.filename,
      ),
    );

    const files = (await readdir(migrationDir)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      console.log(`Applying ${file}...`);
      const sql = await readFile(resolve(migrationDir, file), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await pool.query(trimmed);
      }
      await pool.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
      console.log(`Applied ${file}`);
    }

    console.log("Migrations complete.");
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "MIGRATION_FAILED");
  process.exitCode = 1;
});
