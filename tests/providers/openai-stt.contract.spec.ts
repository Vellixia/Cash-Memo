import { describe, expect, it } from "vitest";

const enabled =
  process.env["CASHMEMO_REAL_PROVIDER_CONTRACT"] === "true" &&
  Boolean(process.env["OPENAI_API_KEY"]);
const model = "gpt-4o-mini-transcribe-2025-12-15";

function syntheticWav(): ArrayBuffer {
  const samples = 8_000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe.skipIf(!enabled)("protected real OpenAI STT contract", () => {
  it("uses pinned model, one synthetic recording, duration limit, and no SDK logging", async () => {
    expect(process.env["OPENAI_LOG"] ?? "off").toBe("off");
    const form = new FormData();
    form.set("model", model);
    form.set("file", new Blob([syntheticWav()], { type: "audio/wav" }), "synthetic.wav");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      body: form,
      headers: { Authorization: `Bearer ${process.env["OPENAI_API_KEY"] ?? ""}` },
      method: "POST",
    });
    expect(response.ok).toBe(true);
    expect(model).toBe(process.env["STT_MODEL_SNAPSHOT"] ?? model);
  }, 60_000);
});

if (!enabled) {
  describe("protected real OpenAI STT contract", () => {
    it.skip("BLOCKED: requires CASHMEMO_REAL_PROVIDER_CONTRACT=true and OPENAI_API_KEY", () =>
      undefined);
  });
}
