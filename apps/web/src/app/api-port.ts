export interface SessionView {
  readonly absoluteExpiresAt: string;
  readonly createdAt: string;
  readonly idleExpiresAt: string;
  readonly sessionId: string;
  readonly userId: string;
}

export interface MeView {
  readonly accountStatus: string;
  readonly emailVerified: boolean;
  readonly onboardingState: string;
  readonly preferences: PreferencesView | null;
  readonly profileRevision: string;
  readonly userId: string;
}

export interface PreferencesView {
  readonly defaultCurrency: string;
  readonly locale: string;
  readonly reportingTimezone: string;
  readonly revision: string;
  readonly timezoneBoundaryWarningRequired: boolean;
}

export interface GenericAuthAccepted {
  readonly messageCode: "CHECK_EMAIL_IF_ELIGIBLE";
  readonly status: "accepted";
}

export type AuthErrorCode =
  "AUTH_ACTION_INVALID" | "AUTH_FAILED" | "AUTH_TEMPORARILY_UNAVAILABLE" | "EMAIL_NOT_VERIFIED";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "AuthError";
  }
}

export interface SignUpInput {
  readonly email: string;
  readonly idempotencyKey: string;
  readonly password: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface OnboardingInput {
  readonly defaultCurrency: string;
  readonly idempotencyKey: string;
  readonly locale: string;
  readonly privacyNoticeVersion: string;
  readonly reportingTimezone: string;
}

export interface PreferencesUpdateInput {
  readonly defaultCurrency?: string;
  readonly expectedRevision: string;
  readonly locale?: string;
  readonly reportingTimezone?: string;
}

export interface ApiPort {
  signUp(input: Readonly<SignUpInput>): Promise<GenericAuthAccepted>;
  resendVerification(email: string): Promise<GenericAuthAccepted>;
  verifyEmail(token: string): Promise<void>;
  login(input: Readonly<LoginInput>): Promise<SessionView>;
  logout(): Promise<void>;
  getSession(): Promise<SessionView | null>;
  requestPasswordReset(email: string): Promise<GenericAuthAccepted>;
  completePasswordReset(token: string, newPassword: string): Promise<void>;
  getMe(): Promise<MeView>;
  completeOnboarding(input: Readonly<OnboardingInput>): Promise<MeView>;
  getPreferences(): Promise<PreferencesView>;
  updatePreferences(input: Readonly<PreferencesUpdateInput>): Promise<PreferencesView>;
  generateIdempotencyKey(): string;
}
