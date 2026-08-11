/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from "vitest";

import { PayloadCaptureProxy } from "@cashmemo/test-support";

describe("provider payload minimization proxy", () => {
  it("forwards only the current typed text and retains content-free metadata", async () => {
    const proxy = new PayloadCaptureProxy();
    let observed = "";
    await proxy.text("synthetic current capture", async (value) => {
      observed = value;
      return true;
    });
    expect(observed).toBe("synthetic current capture");
    expect(proxy.metadata).toEqual([
      { inputLengthClass: "small", operation: "extraction", payloadKind: "text" },
    ]);
    expect(JSON.stringify(proxy.metadata)).not.toContain("synthetic");
  });

  it("forwards only current audio and retains no audio bytes", async () => {
    const proxy = new PayloadCaptureProxy();
    const bytes = Uint8Array.from([7, 8, 9]);
    await proxy.audio(bytes, async (value) => value.byteLength);
    bytes.fill(0);
    expect(proxy.metadata).toEqual([
      { inputLengthClass: "small", operation: "stt", payloadKind: "audio" },
    ]);
    expect(JSON.stringify(proxy.metadata)).not.toMatch(/7|8|9/u);
  });

  it("has no account history, label, memo, credential, or analytics surface", () => {
    const keys = Object.getOwnPropertyNames(PayloadCaptureProxy.prototype).sort();
    expect(keys).toEqual(["audio", "constructor", "text"]);
  });
});
