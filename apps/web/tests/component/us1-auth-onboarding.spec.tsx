import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type {
  ApiPort,
  GenericAuthAccepted,
  MeView,
  PreferencesView,
  SessionView,
} from "../../src/app/api-port.js";
import { AuthError } from "../../src/app/api-port.js";
import { AuthRoutes } from "../../src/features/auth/AuthRoutes.js";

const ACCEPTED: GenericAuthAccepted = {
  messageCode: "CHECK_EMAIL_IF_ELIGIBLE",
  status: "accepted",
};

const MOCK_SESSION: SessionView = {
  absoluteExpiresAt: "2026-09-08T12:00:00.000Z",
  createdAt: "2026-08-09T12:00:00.000Z",
  idleExpiresAt: "2026-08-16T12:00:00.000Z",
  sessionId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000001",
};

const MOCK_ME: MeView = {
  accountStatus: "active",
  emailVerified: true,
  onboardingState: "not_started",
  preferences: null,
  profileRevision: "1",
  userId: "00000000-0000-4000-8000-000000000001",
};

const MOCK_PREFS: PreferencesView = {
  defaultCurrency: "USD",
  locale: "en-US",
  reportingTimezone: "America/New_York",
  revision: "1",
  timezoneBoundaryWarningRequired: false,
};

function createMockApi(overrides: Partial<ApiPort> = {}): ApiPort {
  return {
    completeOnboarding: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "complete" })),
    completePasswordReset: vi.fn(async () => undefined),
    generateIdempotencyKey: vi.fn(() => "0198a6d8-0000-7c55-a5b1-a3f27f8234f1"),
    getMe: vi.fn(async () => MOCK_ME),
    getPreferences: vi.fn(async () => MOCK_PREFS),
    getSession: vi.fn(async () => null),
    login: vi.fn(async () => MOCK_SESSION),
    logout: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => ACCEPTED),
    resendVerification: vi.fn(async () => ACCEPTED),
    signUp: vi.fn(async () => ACCEPTED),
    updatePreferences: vi.fn(async () => ({ ...MOCK_PREFS, revision: "2" })),
    verifyEmail: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function renderApp(api: ApiPort) {
  const result = render(<AuthRoutes api={api} />);
  await waitFor(() => {
    expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
  });
  return result;
}

describe("US1 auth and onboarding component tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Signup ───

  it("renders signup form with email and password fields", async () => {
    const api = createMockApi();
    await renderApp(api);
    expect(screen.getByTestId("signup-form")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
  });

  it("shows generic accepted response after signup", async () => {
    const api = createMockApi();
    await renderApp(api);
    await fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.test" },
    });
    await fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Synthetic-Password-1!" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    await waitFor(() => {
      expect(api.signUp).toHaveBeenCalled();
    });
  });

  it("shows verification-required state after signup", async () => {
    const api = createMockApi();
    await renderApp(api);
    await fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.test" },
    });
    await fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Synthetic-Password-1!" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    await waitFor(() => {
      expect(screen.getByTestId("verification-required")).toBeInTheDocument();
    });
  });

  it("resends verification on request", async () => {
    const api = createMockApi();
    await renderApp(api);
    await fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.test" },
    });
    await fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Synthetic-Password-1!" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    await waitFor(
      () => {
        expect(screen.getByTestId("verification-required")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    const resendInputs = screen.getAllByPlaceholderText("Email");
    const resendInput = resendInputs[resendInputs.length - 1];
    if (resendInput === undefined) throw new Error("resend input not found");
    await fireEvent.change(resendInput, {
      target: { value: "test@example.test" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Resend verification" }));
    await waitFor(() => {
      expect(api.resendVerification).toHaveBeenCalledWith("test@example.test");
    });
  });

  // ─── Login ───

  it("renders login form", async () => {
    const api = createMockApi();
    await renderApp(api);
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("logs in successfully and shows authenticated state", async () => {
    const api = createMockApi({
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "complete" })),
    });
    await renderApp(api);
    await fireEvent.change(screen.getByTestId("login-email"), {
      target: { value: "test@example.test" },
    });
    await fireEvent.change(screen.getByTestId("login-password"), {
      target: { value: "Synthetic-Password-1!" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => {
      expect(api.login).toHaveBeenCalled();
    });
  });

  it("shows generic failure on invalid credentials without revealing account existence", async () => {
    const api = createMockApi({
      login: vi.fn(async () => {
        throw new AuthError("AUTH_FAILED", false);
      }),
    });
    await renderApp(api);
    await fireEvent.change(screen.getByTestId("login-email"), {
      target: { value: "wrong@example.test" },
    });
    await fireEvent.change(screen.getByTestId("login-password"), {
      target: { value: "WrongPassword-1!" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(
      () => {
        expect(screen.getByTestId("auth-failed")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(screen.queryByText("wrong@example.test")).not.toBeInTheDocument();
  });

  it("shows email-not-verified state when login is rejected for unverified email", async () => {
    const api = createMockApi({
      login: vi.fn(async () => {
        throw new AuthError("EMAIL_NOT_VERIFIED", false);
      }),
    });
    await renderApp(api);
    await fireEvent.change(screen.getByTestId("login-email"), {
      target: { value: "unverified@example.test" },
    });
    await fireEvent.change(screen.getByTestId("login-password"), {
      target: { value: "Synthetic-Password-1!" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(
      () => {
        expect(screen.getByTestId("email-not-verified")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  // ─── Logout ───

  it("logs out and clears session", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "complete" })),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("logout-button")).toBeInTheDocument();
    });
    await fireEvent.click(screen.getByTestId("logout-button"));
    await waitFor(() => {
      expect(api.logout).toHaveBeenCalled();
    });
  });

  // ─── Session ───

  it("restores session on page load", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "complete" })),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(api.getSession).toHaveBeenCalled();
    });
  });

  it("shows expired session state when session is null", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => null),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("unauthenticated")).toBeInTheDocument();
    });
  });

  // ─── Password Reset ───

  it("shows password reset request form", async () => {
    const api = createMockApi();
    await renderApp(api);
    expect(screen.getByTestId("reset-request-form")).toBeInTheDocument();
  });

  it("returns generic accepted for password reset request", async () => {
    const api = createMockApi();
    await renderApp(api);
    await fireEvent.change(screen.getByTestId("reset-email"), {
      target: { value: "reset@example.test" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Request reset" }));
    await waitFor(() => {
      expect(api.requestPasswordReset).toHaveBeenCalledWith("reset@example.test");
    });
  });

  it("shows reset completion form", async () => {
    const api = createMockApi();
    await renderApp(api);
    expect(screen.getByTestId("reset-complete-form")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  it("completes password reset with token", async () => {
    const api = createMockApi();
    await renderApp(api);
    await fireEvent.change(screen.getByTestId("reset-token"), {
      target: { value: "synthetic-reset-token-not-real-1234567890" },
    });
    await fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "NewSynthetic-Password-1!" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Complete reset" }));
    await waitFor(() => {
      expect(api.completePasswordReset).toHaveBeenCalled();
    });
  });

  it("shows reset error on invalid/expired token", async () => {
    const api = createMockApi({
      completePasswordReset: vi.fn(async () => {
        throw new AuthError("AUTH_ACTION_INVALID", false);
      }),
    });
    await renderApp(api);
    await fireEvent.change(screen.getByTestId("reset-token"), {
      target: { value: "expired-token-not-real-12345678901234" },
    });
    await fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "NewSynthetic-Password-1!" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Complete reset" }));
    await waitFor(() => {
      expect(screen.getByTestId("reset-error")).toBeInTheDocument();
    });
  });

  // ─── Onboarding ───

  it("shows onboarding form when session is active but onboarding not started", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "not_started" })),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-form")).toBeInTheDocument();
    });
  });

  it("shows privacy notice and requires acknowledgement", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "not_started" })),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("privacy-notice")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Complete onboarding" })).toBeDisabled();
  });

  it("requires privacy acknowledgement before completing onboarding", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "not_started" })),
      completeOnboarding: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "complete" })),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-form")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Complete onboarding" })).toBeDisabled();
    await fireEvent.click(screen.getByTestId("privacy-ack"));
    expect(screen.getByRole("button", { name: "Complete onboarding" })).not.toBeDisabled();
  });

  it("allows selecting default currency, locale, and timezone", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "not_started" })),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-form")).toBeInTheDocument();
    });
    expect(screen.getByTestId("default-currency")).toBeInTheDocument();
    expect(screen.getByTestId("locale")).toBeInTheDocument();
    expect(screen.getByTestId("reporting-timezone")).toBeInTheDocument();
  });

  it("shows timezone warning when timezone is changed", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({
        ...MOCK_ME,
        onboardingState: "not_started",
        preferences: {
          defaultCurrency: "USD",
          locale: "en-US",
          reportingTimezone: "Asia/Tokyo",
          revision: "1",
          timezoneBoundaryWarningRequired: true,
        },
      })),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("timezone-warning")).toBeInTheDocument();
    });
  });

  it("completes onboarding and shows empty journal", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "not_started" })),
      completeOnboarding: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "complete" })),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-form")).toBeInTheDocument();
    });
    await fireEvent.click(screen.getByTestId("privacy-ack"));
    await fireEvent.click(screen.getByRole("button", { name: "Complete onboarding" }));
    await waitFor(() => {
      expect(api.completeOnboarding).toHaveBeenCalled();
    });
  });

  it("shows recoverable error on onboarding submission failure", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "not_started" })),
      completeOnboarding: vi.fn(async () => {
        throw new AuthError("AUTH_TEMPORARILY_UNAVAILABLE", true);
      }),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-form")).toBeInTheDocument();
    });
    await fireEvent.click(screen.getByTestId("privacy-ack"));
    await fireEvent.click(screen.getByRole("button", { name: "Complete onboarding" }));
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-retryable")).toBeInTheDocument();
    });
  });

  it("shows starter labels and empty journal state", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "complete" })),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("empty-journal")).toBeInTheDocument();
    });
  });

  // ─── Security/Privacy ───

  it("does not expose internal error details on auth failure", async () => {
    const api = createMockApi({
      login: vi.fn(async () => {
        throw new AuthError("AUTH_TEMPORARILY_UNAVAILABLE", true);
      }),
    });
    await renderApp(api);
    await fireEvent.change(screen.getByTestId("login-email"), {
      target: { value: "test@example.test" },
    });
    await fireEvent.change(screen.getByTestId("login-password"), {
      target: { value: "Synthetic-Password-1!" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => {
      expect(screen.getByTestId("auth-unavailable")).toBeInTheDocument();
    });
    expect(screen.queryByText("AUTH_TEMPORARILY_UNAVAILABLE")).not.toBeInTheDocument();
    expect(screen.queryByText("internal")).not.toBeInTheDocument();
  });

  it("does not render session tokens or verification tokens", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => MOCK_SESSION),
      getMe: vi.fn(async () => ({ ...MOCK_ME, onboardingState: "complete" })),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("authenticated")).toBeInTheDocument();
    });
    expect(screen.queryByText(MOCK_SESSION.sessionId)).not.toBeInTheDocument();
    expect(screen.queryByText("token")).not.toBeInTheDocument();
  });

  it("does not accept user/account ID from UI state as authority", async () => {
    const api = createMockApi({
      getSession: vi.fn(async () => null),
    });
    await renderApp(api);
    await waitFor(() => {
      expect(screen.getByTestId("unauthenticated")).toBeInTheDocument();
    });
    expect(screen.queryByText(MOCK_ME.userId)).not.toBeInTheDocument();
  });
});
