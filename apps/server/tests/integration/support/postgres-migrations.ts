import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Pool } from "pg";

export const ACCEPTED_PRE_0003_MIGRATION_FILES = [
  "0001_cashmemo_mvp.sql",
  "0002_roles_rls.sql",
] as const;
export const ACCEPTED_PRE_0005_MIGRATION_FILES = [
  ...ACCEPTED_PRE_0003_MIGRATION_FILES,
  "0003_better_auth_compat.sql",
  "0004_identity_access_boundary.sql",
] as const;
export const MIGRATION_FILES = [
  ...ACCEPTED_PRE_0005_MIGRATION_FILES,
  "0005_search_projection.sql",
] as const;
export type MigrationFilename = (typeof MIGRATION_FILES)[number];

export const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../src/adapters/postgres/migrations",
);

export async function readMigration(filename: MigrationFilename): Promise<string> {
  return readFile(resolve(migrationDirectory, filename), "utf8");
}

export async function applyMigrationFiles(
  pool: Pool,
  filenames: readonly MigrationFilename[],
): Promise<void> {
  for (const filename of filenames) {
    const migration = await readMigration(filename);
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim().length > 0) await pool.query(statement);
    }
  }
}

export async function applyMigrations(pool: Pool): Promise<void> {
  await applyMigrationFiles(pool, MIGRATION_FILES);
  await pool.query(`
    GRANT cashmemo_runtime, cashmemo_worker, cashmemo_migration, cashmemo_restore, cashmemo_identity
    TO CURRENT_USER
  `);
}

export async function verifyMigrationChecksums(): Promise<Readonly<Record<string, string>>> {
  const manifest = await readFile(resolve(migrationDirectory, "checksums.sha256"), "utf8");
  const expected: Record<string, string> = Object.fromEntries(
    manifest
      .trim()
      .split("\n")
      .map((line) => {
        const match = /^([0-9a-f]{64})\s{2}([^\s]+)$/u.exec(line);
        const hash = match?.[1];
        const filename = match?.[2];
        if (hash === undefined || filename === undefined) {
          throw new Error("INVALID_MIGRATION_CHECKSUM_MANIFEST");
        }
        return [filename, hash] as const;
      }),
  );

  for (const filename of MIGRATION_FILES) {
    const migration = await readMigration(filename);
    const actual = createHash("sha256").update(migration).digest("hex");
    if (expected[filename] !== actual) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${filename}`);
  }
  return expected;
}

export function connectionUriForDatabase(connectionUri: string, database: string): string {
  const url = new URL(connectionUri);
  url.pathname = `/${database}`;
  return url.toString();
}
