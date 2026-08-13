import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { privacyBoundaryMatrix } from "../../packages/privacy-rules/src/boundary-matrix.js";
import { detectTextV1 } from "../../packages/privacy-rules/src/detector-v1.js";
import { PayloadCaptureProxy } from "../../packages/test-support/src/providers/payload-capture-proxy.js";

describe("raw voice and transcript privacy boundaries", () => {
  it("declares raw voice before textual transcript detector", () => {
    const raw = privacyBoundaryMatrix.findIndex(
      (item) => item.boundary === "raw_voice_stt_transmission",
    );
    const transcript = privacyBoundaryMatrix.findIndex(
      (item) => item.boundary === "transcript_persistence",
    );
    expect(raw).toBeLessThan(transcript);
    expect(privacyBoundaryMatrix[raw]).toMatchObject({
      consentRequired: true,
      detectorRequired: false,
      source: "current_recording",
    });
  });

  it("sends only current capture to STT and retains content-free metadata", async () => {
    const proxy = new PayloadCaptureProxy();
    const stt = vi.fn<(audio: Uint8Array) => Promise<string>>(() =>
      Promise.resolve("allowed transcript"),
    );
    await proxy.audio(Uint8Array.from([1, 2, 3]), stt);
    expect(stt).toHaveBeenCalledOnce();
    expect(proxy.metadata).toEqual([
      { inputLengthClass: "small", operation: "stt", payloadKind: "audio" },
    ]);
  });

  it("allows only detector-approved transcript to extraction", async () => {
    const extraction = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    const allowed = "synthetic lunch expense";
    if (detectTextV1(allowed).decision === "allow") await extraction(allowed);
    const blocked = "card number 4111111111111111";
    if (detectTextV1(blocked).decision === "allow") await extraction(blocked);
    expect(extraction).toHaveBeenCalledTimes(1);
  });

  it("documents unavoidable raw-audio ordering and no durable audio stores", async () => {
    const documentation = await readFile(
      new URL("../../docs/privacy/voice-processing.md", import.meta.url),
      "utf8",
    );
    expect(documentation).toMatch(/cannot inspect speech before STT/iu);
    expect(documentation).toMatch(
      /never belongs in PostgreSQL, RustFS,\s+IndexedDB, evidence, logs/iu,
    );
  });
});
