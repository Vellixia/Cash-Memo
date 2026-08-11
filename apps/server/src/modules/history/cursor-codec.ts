import { createHmac, randomBytes } from "node:crypto";

const CURSOR_FORMAT_VERSION = 1;

export interface CursorPayload {
  readonly cursorFormatVersion: number;
  readonly lastOccurredAt: string;
  readonly lastId: string;
  readonly queryFingerprint: string;
  readonly version: number;
}

export class CursorCodecError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CursorCodecError";
  }
}

export interface CursorCodecOptions {
  readonly hmacKey: Uint8Array;
}

export function encodeCursor(
  payload: Readonly<CursorPayload>,
  options: Readonly<CursorCodecOptions>,
): string {
  if (payload.cursorFormatVersion !== CURSOR_FORMAT_VERSION) {
    throw new CursorCodecError("UNSUPPORTED_CURSOR_VERSION");
  }
  const canonical = JSON.stringify({
    cursorFormatVersion: payload.cursorFormatVersion,
    lastId: payload.lastId,
    lastOccurredAt: payload.lastOccurredAt,
    queryFingerprint: payload.queryFingerprint,
    version: payload.version,
  });
  const mac = createHmac("sha256", Buffer.from(options.hmacKey))
    .update(canonical)
    .digest("base64url");
  return `${Buffer.from(canonical).toString("base64url")}.${mac}`;
}

export function decodeCursor(
  encoded: string,
  options: Readonly<CursorCodecOptions>,
): CursorPayload {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new CursorCodecError("MALFORMED_CURSOR");
  }
  const separatorIndex = encoded.lastIndexOf(".");
  if (separatorIndex === -1) {
    throw new CursorCodecError("MALFORMED_CURSOR");
  }
  const encodedPayload = encoded.slice(0, separatorIndex);
  const receivedMac = encoded.slice(separatorIndex + 1);
  let canonical: string;
  try {
    canonical = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    throw new CursorCodecError("MALFORMED_CURSOR");
  }
  const expectedMac = createHmac("sha256", Buffer.from(options.hmacKey))
    .update(canonical)
    .digest("base64url");
  if (receivedMac !== expectedMac) {
    throw new CursorCodecError("CURSOR_TAMPERED");
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(canonical) as Record<string, unknown>;
  } catch {
    throw new CursorCodecError("MALFORMED_CURSOR");
  }
  if (parsed["cursorFormatVersion"] !== CURSOR_FORMAT_VERSION) {
    throw new CursorCodecError("UNSUPPORTED_CURSOR_VERSION");
  }
  const versionRaw = parsed["version"];
  return {
    cursorFormatVersion: CURSOR_FORMAT_VERSION,
    lastId: parsed["lastId"] as string,
    lastOccurredAt: parsed["lastOccurredAt"] as string,
    queryFingerprint: parsed["queryFingerprint"] as string,
    version: typeof versionRaw === "number" ? versionRaw : Number(versionRaw),
  };
}

export function generateCursorHmacKey(): Uint8Array {
  return randomBytes(32);
}
