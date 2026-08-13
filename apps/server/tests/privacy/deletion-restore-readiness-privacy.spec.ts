import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const ARTIFACT = new URL(
  "../../../../ops/evidence/operations/deletion-restore-readiness.json",
  import.meta.url,
);
const MANIFEST = new URL(
  "../../../../ops/evidence/operations/deletion-restore-readiness.manifest.json",
  import.meta.url,
);
const SUPERSESSION = new URL(
  "../../../../ops/evidence/historical/aws-environment.superseded.json",
  import.meta.url,
);
const CURRENT_WRITER = new URL(
  "../../../../scripts/operations/write-deletion-restore-readiness.ts",
  import.meta.url,
);

describe("Phase 13 readiness evidence privacy", () => {
  it("states non-production readiness, SC-021 open, and real PITR open", async () => {
    const evidence = await readFile(ARTIFACT, "utf8");
    const supersession = await readFile(SUPERSESSION, "utf8");
    const writer = await readFile(CURRENT_WRITER, "utf8");
    expect(evidence).toContain("phase13.evidence-class-non-production-readiness");
    expect(evidence).toContain("phase13.sc021-open");
    expect(evidence).toContain("phase13.real-aws-pitr-drill-open");
    expect(supersession).toContain("historical-not-current-proof");
    expect(supersession).toContain("ops/evidence/operations/deletion-restore-readiness.json");
    expect(writer).toContain("phase13.real-pgbackrest-pitr-drill-open");
    expect(evidence).not.toContain("SC-021 PASS");
  });

  it("contains no raw UUID, email, deletion token, key, or financial content", async () => {
    const content = `${await readFile(ARTIFACT, "utf8")}\n${await readFile(MANIFEST, "utf8")}`;
    for (const rawEntityId of [
      "00000000-0000-4000-8000-000000000194",
      "00000000-0000-4000-8000-000000000195",
      "10000000-0000-4000-8000-000000000194",
    ]) {
      expect(content).not.toContain(rawEntityId);
    }
    expect(content).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
    expect(content).not.toMatch(
      /deletionToken|suppressionKey|amountMinor|memoContent|rawRequest|rawResponse/u,
    );
  });

  it("records only contract/synthetic adapter mode", async () => {
    const manifest = await readFile(MANIFEST, "utf8");
    expect(manifest).toContain("local-contract-readiness");
    expect(manifest).not.toMatch(/production deletion\/restore verified|production-pitr-pass/iu);
  });
});
