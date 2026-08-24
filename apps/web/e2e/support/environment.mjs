export function normalizePublicOrigin(value) {
  return new URL(value).origin;
}

export const PUBLIC_ORIGIN = normalizePublicOrigin(
  process.env.CASHMEMO_V1_E2E_PUBLIC_ORIGIN ?? "http://localhost:3000",
);
