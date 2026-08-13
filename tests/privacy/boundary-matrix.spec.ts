import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { privacyBoundaryMatrix } from "../../packages/privacy-rules/src/boundary-matrix.js";
import { privacyTrustBoundaries } from "../../packages/privacy-rules/src/contracts.js";
import { PrivacyBoundaryService } from "../../apps/server/src/modules/privacy/privacy-boundary.service.js";
import { evaluateBrowserPrivacy } from "../../apps/web/src/privacy/privacy-boundary.js";

const root = new URL("../../", import.meta.url);
const candidate = "card number 4111111111111111";

describe("complete privacy boundary matrix", () => {
  it("declares every covered trust boundary exactly once", () => {
    expect(privacyBoundaryMatrix.map((item) => item.boundary).sort()).toEqual(
      [...privacyTrustBoundaries].sort(),
    );
    expect(new Set(privacyBoundaryMatrix.map((item) => item.boundary)).size).toBe(
      privacyBoundaryMatrix.length,
    );
    expect(privacyBoundaryMatrix).toHaveLength(11);
  });

  it("declares enforcement, retention, diagnostic prohibition, and blocking result for every boundary", () => {
    for (const item of privacyBoundaryMatrix) {
      expect(item.enforcingAdapter).not.toBe("");
      expect(item.retentionClass).not.toBe("");
      expect(item.diagnosticProhibition).toBe(true);
      expect(item.expectedBlockingResult).toMatch(/BLOCKED$/u);
    }
  });

  it("fails coverage when an enforcing adapter path is missing", async () => {
    await Promise.all(
      privacyBoundaryMatrix.map(async (item) => access(new URL(item.enforcingAdapter, root))),
    );
  });

  it("blocks device draft candidate before persistence and does not authorize server", async () => {
    expect(evaluateBrowserPrivacy("device_draft_persistence", candidate).decision).toBe(
      "block_match",
    );
    const server = new PrivacyBoundaryService();
    await expect(server.requireAllowed("server_draft_persistence", candidate)).rejects.toThrow(
      "PRIVACY_BOUNDARY_BLOCKED",
    );
  });

  it("keeps device drafts account-scoped and raw-audio-free", async () => {
    const source = await readFile(
      new URL("apps/web/src/features/degraded/recoverable-draft.ts", root),
      "utf8",
    );
    expect(source).toContain("accountScope");
    expect(source).not.toMatch(/audio|blob|arraybuffer/iu);
  });

  it("enforces manual Money Memo notes before authoritative writes", async () => {
    const source = await readFile(new URL("apps/server/src/bootstrap/server.ts", root), "utf8");
    const boundary = source.indexOf('boundary: "memo_note_persistence"');
    const persistence = source.indexOf("return createMoneyMemo(", boundary);
    expect(boundary).toBeGreaterThan(-1);
    expect(persistence).toBeGreaterThan(boundary);
  });

  it.each([
    "server_draft_persistence",
    "typed_text_ai_transmission",
    "transcript_persistence",
    "transcript_ai_transmission",
    "memo_note_persistence",
    "label_persistence",
    "search_execution",
    "support_capture",
    "evidence_capture",
  ] as const)("server blocks candidate at %s", async (boundary) => {
    await expect(new PrivacyBoundaryService().requireAllowed(boundary, candidate)).rejects.toThrow(
      "PRIVACY_BOUNDARY_BLOCKED",
    );
  });

  it("declares consent only at typed, raw voice, and transcript provider transmissions", () => {
    expect(
      privacyBoundaryMatrix
        .filter((item) => item.consentRequired)
        .map((item) => item.boundary)
        .sort(),
    ).toEqual([
      "raw_voice_stt_transmission",
      "transcript_ai_transmission",
      "typed_text_ai_transmission",
    ]);
  });

  it("declares textual detector after raw voice/STT boundary, never before audio", () => {
    const raw = privacyBoundaryMatrix.find(
      (item) => item.boundary === "raw_voice_stt_transmission",
    );
    const transcript = privacyBoundaryMatrix.find(
      (item) => item.boundary === "transcript_persistence",
    );
    expect(raw).toMatchObject({
      detectorRequired: false,
      retentionClass: "current_operation_only",
    });
    expect(transcript).toMatchObject({ detectorRequired: true, source: "stt_transcript" });
  });
});
