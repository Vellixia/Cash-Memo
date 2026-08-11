import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from "vitest";

import {
  DeterministicExtractionAdapter,
  DeterministicSttAdapter,
} from "../../src/adapters/fakes/assisted-provider.adapters.js";
import {
  assertExtractionRequest,
  assertSttRequest,
  type ExtractionPort,
  type SttPort,
} from "../../src/modules/assisted-capture/provider-ports.js";

const extractionRequest = {
  attempt: 1,
  captureStartedAt: "2026-08-11T10:00:00Z",
  captureTimezone: "Asia/Jakarta",
  consent: "SEND_THIS_TEXT_FOR_AI_EXTRACTION" as const,
  deadlineMs: 10_000,
  text: "synthetic allowed capture",
};

const sttRequest = {
  attempt: 1,
  audio: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
  consent: "SEND_THIS_RECORDING_FOR_TRANSCRIPTION" as const,
  currentRecordingOnly: true as const,
  deadlineMs: 15_000,
  detectorLimitationDisclosed: true as const,
  mediaType: "audio/wav" as const,
};

describe("assisted provider-owned port contracts", () => {
  it("accepts strict bounded provider-neutral requests", () => {
    expect(() => {
      assertExtractionRequest(extractionRequest);
    }).not.toThrow();
    expect(() => {
      assertSttRequest(sttRequest);
    }).not.toThrow();
  });

  it.each([0, 3])("rejects extraction attempt %s outside bounded retry policy", (attempt) => {
    expect(() => {
      assertExtractionRequest({ ...extractionRequest, attempt });
    }).toThrow("PROVIDER_REQUEST_INVALID");
  });

  it("rejects missing operation-specific consent and unsafe deadlines", () => {
    expect(() => {
      assertExtractionRequest({ ...extractionRequest, consent: "wrong" });
    }).toThrow("PROVIDER_CONSENT_REQUIRED");
    expect(() => {
      assertSttRequest({ ...sttRequest, deadlineMs: 60_001 });
    }).toThrow("PROVIDER_REQUEST_INVALID");
  });

  it.each(["success", "incomplete", "timeout", "rate_limit", "refusal", "failure"] as const)(
    "returns provider-neutral STT state for %s",
    async (mode) => {
      const port: SttPort = new DeterministicSttAdapter({ mode });
      const result = await port.transcribe(sttRequest);
      expect(result.state).toBe(mode === "failure" ? "unavailable" : mode);
      expect(JSON.stringify(result)).not.toMatch(/request[_-]?id|provider[_-]?payload|sdk/iu);
    },
  );

  it.each([
    "success",
    "ambiguous",
    "invalid_schema",
    "timeout",
    "rate_limit",
    "refusal",
    "failure",
  ] as const)("returns provider-neutral extraction state for %s", async (mode) => {
    const port: ExtractionPort = new DeterministicExtractionAdapter({ mode });
    const result = await port.extract(extractionRequest);
    expect(result.state).toBe(mode === "failure" ? "unavailable" : mode);
    expect(JSON.stringify(result)).not.toMatch(/request[_-]?id|provider[_-]?payload|sdk/iu);
  });

  it("never returns confirmation or authoritative memo state", async () => {
    const extraction = await new DeterministicExtractionAdapter({ mode: "success" }).extract(
      extractionRequest,
    );
    const speech = await new DeterministicSttAdapter({ mode: "success" }).transcribe(sttRequest);
    expect(JSON.stringify([extraction, speech])).not.toMatch(/confirm|authoritative|moneyMemo/iu);
  });

  it("supports replacement adapters through project-owned interfaces", async () => {
    const stt: SttPort = {
      transcribe: async () => ({
        completeness: "complete",
        state: "success",
        transcript: "synthetic",
      }),
    };
    const extraction: ExtractionPort = {
      extract: async () => ({ assessments: [], fields: {}, state: "success" }),
    };
    expect((await stt.transcribe(sttRequest)).state).toBe("success");
    expect((await extraction.extract(extractionRequest)).state).toBe("success");
  });

  it("keeps provider SDK types out of application port source", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../src/modules/assisted-capture/provider-ports.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/openai|anthropic|sdk|responses\.create|audio\.transcriptions/iu);
  });
});
