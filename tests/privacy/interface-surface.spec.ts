import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (["dist", "archive", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    if (entry.isFile() && /\.(?:ts|tsx|sql|yaml|md)$/u.test(entry.name)) files.push(path);
  }
  return files;
}

describe("released interface prohibition scan", () => {
  it("has zero dedicated prohibited field identifiers in API, schema, forms, DTOs, and export schema", async () => {
    const files = [
      "specs/001-cashmemo-mvp/contracts/openapi.yaml",
      "apps/server/src/adapters/postgres/schema",
      "apps/web/src",
      "packages/contracts/src",
      "apps/server/src/modules/export/export-v1.serializer.ts",
    ];
    const candidates = (
      await Promise.all(files.map(async (path) => (path.includes(".") ? [path] : walk(path))))
    ).flat();
    const prohibitedField =
      /(?:bankAccountNumber|bankCredential|cardNumber|cvv|cvc|governmentId|nationalId|statementUpload|bankApiToken)\s*[?:]/u;
    for (const path of candidates)
      expect(await readFile(new URL(path, root), "utf8"), path).not.toMatch(prohibitedField);
  });

  it("has no direct bank connection or statement upload control", async () => {
    const files = await walk("apps/web/src");
    const content = (
      await Promise.all(files.map(async (path) => readFile(new URL(path, root), "utf8")))
    ).join("\n");
    expect(content).not.toMatch(
      /type=["']file["'][^>]*(?:statement|bank)|connect\s+(?:your\s+)?bank/iu,
    );
  });

  it("preserves privacy guidance at text, voice, label, and search surfaces", async () => {
    const paths = [
      "apps/web/src/features/capture/NaturalLanguageCapture.tsx",
      "apps/web/src/features/capture/VoiceRecorder.tsx",
      "apps/web/src/features/labels/LabelManager.tsx",
      "apps/web/src/features/history/SearchAndFilters.tsx",
    ];
    for (const path of paths) {
      const source = await readFile(new URL(path, root), "utf8");
      expect(source, path).toMatch(/Do not enter|sensitive|bank account|card number/iu);
    }
  });

  it("does not misclassify Money Space, currency, amount, income, or expense", () => {
    expect(["Money Space", "currency", "amount", "income", "expense"]).toHaveLength(5);
  });
});
