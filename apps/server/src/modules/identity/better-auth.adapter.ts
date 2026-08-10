import { argon2id, hash as argonHash, verify as argonVerify } from "argon2";
import { betterAuth } from "better-auth";
import type { Pool } from "pg";

export const BETTER_AUTH_COMPATIBILITY_NAME = "Cashmemo account";
export const BETTER_AUTH_SESSION_COOKIE = "__Host-cashmemo_session";
export const BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
export const BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS = 60 * 60;
export const BETTER_AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS = 60 * 60;

const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 24 * 60 * 60;
const ARGON2ID_MEMORY_COST_KIB = 19_456;
const ARGON2ID_TIME_COST = 2;
const ARGON2ID_PARALLELISM = 1;
const ARGON2ID_HASH_LENGTH = 32;

export interface AuthActionDelivery {
  destination: string;
  oneTimeUrl: string;
  token: string;
}

export interface BetterAuthDeliveryCallbacks {
  sendPasswordReset(input: Readonly<AuthActionDelivery>): Promise<void>;
  sendVerification(input: Readonly<AuthActionDelivery>): Promise<void>;
}

export interface BetterAuthAdapterOptions {
  baseURL: string;
  delivery: BetterAuthDeliveryCallbacks;
  identityPool: Pool;
  secret: string;
  trustedOrigins: readonly string[];
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, {
    hashLength: ARGON2ID_HASH_LENGTH,
    memoryCost: ARGON2ID_MEMORY_COST_KIB,
    parallelism: ARGON2ID_PARALLELISM,
    timeCost: ARGON2ID_TIME_COST,
    type: argon2id,
  });
}

export async function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  try {
    return await argonVerify(input.hash, input.password);
  } catch {
    return false;
  }
}

function assertSecureOrigin(value: string, reasonCode: string, enforce = true): void {
  if (!enforce) return;
  const origin = new URL(value);
  if (origin.protocol !== "https:") throw new Error(reasonCode);
}

export function createBetterAuthAdapter(options: Readonly<BetterAuthAdapterOptions>) {
  const isLocalDev = options.baseURL.includes("localhost");
  assertSecureOrigin(options.baseURL, "BETTER_AUTH_HTTPS_BASE_URL_REQUIRED", !isLocalDev);
  for (const origin of options.trustedOrigins) {
    assertSecureOrigin(origin, "BETTER_AUTH_HTTPS_TRUSTED_ORIGIN_REQUIRED", !isLocalDev);
  }
  if (options.secret.length < 32) throw new Error("BETTER_AUTH_SECRET_TOO_SHORT");

  return betterAuth({
    account: {
      fields: {
        accessToken: "access_token",
        accessTokenExpiresAt: "access_token_expires_at",
        accountId: "account_id",
        createdAt: "created_at",
        idToken: "id_token",
        password: "password_hash",
        providerId: "provider",
        refreshToken: "refresh_token",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        updatedAt: "updated_at",
        userId: "user_id",
      },
      modelName: "credential_accounts",
      storeAccountCookie: false,
      storeStateStrategy: "database",
    },
    advanced: {
      cookies: {
        session_token: {
          attributes: {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            secure: true,
          },
          name: BETTER_AUTH_SESSION_COOKIE,
        },
      },
      crossSubDomainCookies: { enabled: false },
      database: { generateId: "uuid" },
      defaultCookieAttributes: {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: true,
      },
      ipAddress: { disableIpTracking: true },
      useSecureCookies: false,
    },
    baseURL: options.baseURL,
    basePath: "/api/v1/auth",
    database: options.identityPool,
    emailAndPassword: {
      enabled: true,
      password: { hash: hashPassword, verify: verifyPassword },
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: BETTER_AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ token, url, user }) =>
        options.delivery.sendPasswordReset({
          destination: user.email,
          oneTimeUrl: url,
          token,
        }),
    },
    emailVerification: {
      autoSignInAfterVerification: false,
      expiresIn: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
      sendOnSignUp: true,
      sendVerificationEmail: async ({ token, url, user }) =>
        options.delivery.sendVerification({
          destination: user.email,
          oneTimeUrl: url,
          token,
        }),
    },
    logger: { disabled: true },
    rateLimit: { enabled: false },
    secret: options.secret,
    session: {
      cookieCache: { enabled: false },
      expiresIn: BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS,
      freshAge: 0,
      fields: {
        createdAt: "created_at",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        updatedAt: "updated_at",
        userAgent: "user_agent",
        userId: "user_id",
      },
      modelName: "sessions",
      updateAge: BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS,
    },
    trustedOrigins: [...options.trustedOrigins],
    user: {
      fields: {
        createdAt: "created_at",
        emailVerified: "email_verified",
        updatedAt: "updated_at",
      },
      modelName: "users",
    },
    verification: {
      fields: {
        createdAt: "created_at",
        expiresAt: "expires_at",
        updatedAt: "updated_at",
      },
      modelName: "verification_tokens",
      storeIdentifier: "hashed",
    },
  });
}
