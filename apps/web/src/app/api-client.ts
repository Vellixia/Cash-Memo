import type {
  ApiPort,
  GenericAuthAccepted,
  LoginInput,
  MeView,
  OnboardingInput,
  PreferencesUpdateInput,
  PreferencesView,
  SessionView,
  SignUpInput,
} from "./api-port.js";
import { AuthError } from "./api-port.js";

const API_BASE = "/api/v1";

function generateIdempotencyKey(): string {
  const timestamp = BigInt(Date.now());
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  const bytes = new Uint8Array(16);
  let ts = timestamp;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }
  const versionSource = bytes[6] ?? 0;
  const variantSource = bytes[8] ?? 0;
  bytes[6] = (versionSource & 0x0f) | 0x70;
  bytes[8] = (variantSource & 0x3f) | 0x80;
  for (let i = 6; i < 16; i++) bytes[i] = rand[i - 6] ?? 0;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function parseJson<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  if (response.status === 401) throw new AuthError("AUTH_FAILED", false);
  if (response.status === 403) throw new AuthError("EMAIL_NOT_VERIFIED", false);
  if (response.status >= 500) throw new AuthError("AUTH_TEMPORARILY_UNAVAILABLE", true);
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const code = body["messageCode"] as string | undefined;
    if (code === "AUTH_ACTION_INVALID") throw new AuthError("AUTH_ACTION_INVALID", false);
    if (code === "AUTH_FAILED") throw new AuthError("AUTH_FAILED", false);
    throw new AuthError("AUTH_TEMPORARILY_UNAVAILABLE", true);
  }
  return body as T;
}

export function createApi(): ApiPort {
  return {
    async signUp(input: Readonly<SignUpInput>): Promise<GenericAuthAccepted> {
      const res = await fetch(`${API_BASE}/auth/sign-up`, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return parseJson<GenericAuthAccepted>(res);
    },

    async resendVerification(email: string): Promise<GenericAuthAccepted> {
      const res = await fetch(`${API_BASE}/auth/verification/resend`, {
        body: JSON.stringify({ email }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return parseJson<GenericAuthAccepted>(res);
    },

    async verifyEmail(token: string): Promise<void> {
      const res = await fetch(`${API_BASE}/auth/verify-email`, {
        body: JSON.stringify({ token }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      await parseJson<unknown>(res);
    },

    async login(input: Readonly<LoginInput>): Promise<SessionView> {
      const res = await fetch(`${API_BASE}/auth/login`, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return parseJson<SessionView>(res);
    },

    async logout(): Promise<void> {
      await fetch(`${API_BASE}/auth/logout`, { method: "POST" });
    },

    async getSession(): Promise<SessionView | null> {
      const res = await fetch(`${API_BASE}/auth/session`);
      if (res.status === 401) return null;
      return parseJson<SessionView>(res);
    },

    async requestPasswordReset(email: string): Promise<GenericAuthAccepted> {
      const res = await fetch(`${API_BASE}/auth/password-reset/request`, {
        body: JSON.stringify({ email }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return parseJson<GenericAuthAccepted>(res);
    },

    async completePasswordReset(token: string, newPassword: string): Promise<void> {
      const res = await fetch(`${API_BASE}/auth/password-reset/complete`, {
        body: JSON.stringify({ newPassword, token }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      await parseJson<unknown>(res);
    },

    async getMe(): Promise<MeView> {
      const res = await fetch(`${API_BASE}/me`);
      return parseJson<MeView>(res);
    },

    async completeOnboarding(input: Readonly<OnboardingInput>): Promise<MeView> {
      const res = await fetch(`${API_BASE}/me/onboarding`, {
        body: JSON.stringify(input),
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": input.idempotencyKey,
        },
        method: "PUT",
      });
      return parseJson<MeView>(res);
    },

    async getPreferences(): Promise<PreferencesView> {
      const res = await fetch(`${API_BASE}/me/preferences`);
      return parseJson<PreferencesView>(res);
    },

    async updatePreferences(input: Readonly<PreferencesUpdateInput>): Promise<PreferencesView> {
      const res = await fetch(`${API_BASE}/me/preferences`, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      return parseJson<PreferencesView>(res);
    },

    generateIdempotencyKey,
  };
}
