export interface ProviderPayloadMetadata {
  readonly inputLengthClass: "empty" | "large" | "medium" | "small";
  readonly operation: "extraction" | "stt";
  readonly payloadKind: "audio" | "text";
}

function classify(length: number): ProviderPayloadMetadata["inputLengthClass"] {
  if (length === 0) return "empty";
  if (length < 1_024) return "small";
  if (length < 1_048_576) return "medium";
  return "large";
}

/** Test-only forwarding proxy. It never stores, hashes, logs, or serializes payload values. */
export class PayloadCaptureProxy {
  readonly metadata: ProviderPayloadMetadata[] = [];

  async text<T>(value: string, forward: (value: string) => Promise<T>): Promise<T> {
    this.metadata.push({
      inputLengthClass: classify(value.length),
      operation: "extraction",
      payloadKind: "text",
    });
    return forward(value);
  }

  async audio<T>(value: Uint8Array, forward: (value: Uint8Array) => Promise<T>): Promise<T> {
    this.metadata.push({
      inputLengthClass: classify(value.byteLength),
      operation: "stt",
      payloadKind: "audio",
    });
    return forward(value);
  }
}
