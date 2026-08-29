export function normalizePublicOrigin(value) {
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(
      "CASHMEMO_V1_E2E_PUBLIC_ORIGIN must use a loopback hostname before authentication or artifact capture.",
    );
  }
  return url.origin;
}

export const PUBLIC_ORIGIN = normalizePublicOrigin(
  process.env.CASHMEMO_V1_E2E_PUBLIC_ORIGIN ?? "http://localhost:3000",
);
