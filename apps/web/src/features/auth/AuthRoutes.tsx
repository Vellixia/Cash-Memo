import { useCallback, useEffect, useState, type SyntheticEvent } from "react";

import type { ApiPort } from "../../app/api-port.js";
import { AuthError } from "../../app/api-port.js";
import type { JournalApiPort } from "../../app/journal-api.js";
import { SearchAndFilters } from "../history/SearchAndFilters.js";
import { LabelManager } from "../labels/LabelManager.js";
import { CurrentMonthOverview } from "../reporting/CurrentMonthOverview.js";

interface AuthRoutesProps {
  api: ApiPort;
  journalApi?: JournalApiPort;
}

type AuthScreen =
  | "loading"
  | "unauthenticated"
  | "verification-required"
  | "email-not-verified"
  | "auth-failed"
  | "auth-unavailable"
  | "onboarding"
  | "empty-journal";

export function AuthRoutes({ api, journalApi }: AuthRoutesProps) {
  const [screen, setScreen] = useState<AuthScreen>("loading");
  const [resetError, setResetError] = useState(false);
  const [onboardingRetryable, setOnboardingRetryable] = useState(false);
  const [showTimezoneWarning, setShowTimezoneWarning] = useState(false);

  useEffect(() => {
    void (async () => {
      const s = await api.getSession();
      if (s === null) {
        setScreen("unauthenticated");
        return;
      }
      try {
        const m = await api.getMe();
        if (m.onboardingState !== "complete") {
          setScreen("onboarding");
          if (m.preferences?.timezoneBoundaryWarningRequired === true) setShowTimezoneWarning(true);
        } else {
          setScreen("empty-journal");
        }
      } catch {
        setScreen("unauthenticated");
      }
    })();
  }, [api]);

  const handleSignup = useCallback(
    async (email: string, password: string) => {
      const idempotencyKey = api.generateIdempotencyKey();
      try {
        await api.signUp({ email, idempotencyKey, password });
      } catch {
        // enumeration-safe: show verification-required even on failure
      }
      setScreen("verification-required");
    },
    [api],
  );

  const handleResend = useCallback(
    async (email: string) => {
      await api.resendVerification(email);
    },
    [api],
  );

  const handleLogin = useCallback(
    async (email: string, password: string) => {
      try {
        await api.login({ email, password });
        const m = await api.getMe();
        if (m.onboardingState !== "complete") {
          setScreen("onboarding");
          if (m.preferences?.timezoneBoundaryWarningRequired === true) setShowTimezoneWarning(true);
        } else {
          setScreen("empty-journal");
        }
      } catch (error) {
        if (error instanceof AuthError) {
          if (error.code === "EMAIL_NOT_VERIFIED") {
            setScreen("email-not-verified");
          } else if (error.code === "AUTH_FAILED") {
            setScreen("auth-failed");
          } else {
            setScreen("auth-unavailable");
          }
        } else {
          setScreen("auth-unavailable");
        }
      }
    },
    [api],
  );

  const handleLogout = useCallback(async () => {
    await api.logout();
    setScreen("unauthenticated");
  }, [api]);

  const handleResetRequest = useCallback(
    async (email: string) => {
      await api.requestPasswordReset(email);
    },
    [api],
  );

  const handleResetComplete = useCallback(
    async (token: string, newPassword: string) => {
      setResetError(false);
      try {
        await api.completePasswordReset(token, newPassword);
      } catch {
        setResetError(true);
      }
    },
    [api],
  );

  const handleCompleteOnboarding = useCallback(
    async (input: {
      defaultCurrency: string;
      locale: string;
      privacyNoticeVersion: string;
      reportingTimezone: string;
    }) => {
      setOnboardingRetryable(false);
      const idempotencyKey = api.generateIdempotencyKey();
      try {
        await api.completeOnboarding({ ...input, idempotencyKey });
        setScreen("empty-journal");
      } catch {
        setOnboardingRetryable(true);
      }
    },
    [api],
  );

  if (screen === "loading") return <div data-testid="loading" />;

  if (screen === "unauthenticated") {
    return (
      <div data-testid="unauthenticated">
        <SignupForm onSubmit={handleSignup} />
        <LoginForm onLogin={handleLogin} />
        <ResetRequestForm onReset={handleResetRequest} />
        <ResetCompleteForm onReset={handleResetComplete} resetError={resetError} />
      </div>
    );
  }

  if (screen === "verification-required") {
    return (
      <div data-testid="verification-required">
        <p>Please verify your email address to continue.</p>
        <ResendButton onResend={handleResend} />
      </div>
    );
  }

  if (screen === "email-not-verified") {
    return (
      <div data-testid="email-not-verified">
        <p>Your email is not verified. Please verify your email before logging in.</p>
        <ResendButton onResend={handleResend} />
      </div>
    );
  }

  if (screen === "auth-failed") {
    return (
      <div data-testid="auth-failed">
        <p>Login failed. Please check your credentials.</p>
        <LoginForm onLogin={handleLogin} />
      </div>
    );
  }

  if (screen === "auth-unavailable") {
    return (
      <div data-testid="auth-unavailable">
        <p>Authentication is temporarily unavailable. Please try again.</p>
        <LoginForm onLogin={handleLogin} />
      </div>
    );
  }

  if (screen === "onboarding") {
    return (
      <OnboardingForm
        onComplete={handleCompleteOnboarding}
        retryable={onboardingRetryable}
        showTimezoneWarning={showTimezoneWarning}
      />
    );
  }

  return (
    <div data-testid="empty-journal">
      <div data-testid="authenticated">
        <h2>Your Money Journal</h2>
        <p>No memos yet. Create your first one to get started.</p>
        <button
          data-testid="logout-button"
          onClick={() => {
            void handleLogout();
          }}
        >
          Log out
        </button>
        {journalApi === undefined ? null : (
          <>
            <CurrentMonthOverview api={journalApi} />
            <LabelManager api={journalApi} />
            <SearchAndFilters api={journalApi} />
          </>
        )}
      </div>
    </div>
  );
}

function SignupForm({
  onSubmit,
}: {
  onSubmit: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    setSubmitting(true);
    void onSubmit(email, password).finally(() => {
      setSubmitting(false);
    });
  };

  return (
    <form data-testid="signup-form" onSubmit={handleSubmit}>
      <label htmlFor="signup-email">Email</label>
      <input
        id="signup-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label htmlFor="signup-password">Password</label>
      <input
        id="signup-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        Sign up
      </button>
    </form>
  );
}

function LoginForm({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    void onLogin(email, password);
  };

  return (
    <form data-testid="login-form" onSubmit={handleSubmit}>
      <input
        data-testid="login-email"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        data-testid="login-password"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit">Log in</button>
    </form>
  );
}

function ResendButton({ onResend }: { onResend: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  return (
    <div>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        onClick={() => {
          void onResend(email);
        }}
      >
        Resend verification
      </button>
    </div>
  );
}

function ResetRequestForm({ onReset }: { onReset: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    void onReset(email).then(() => {
      setDone(true);
    });
  };
  return (
    <form data-testid="reset-request-form" onSubmit={handleSubmit}>
      <input
        data-testid="reset-email"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button type="submit">Request reset</button>
      {done && <p>If eligible, a reset link has been sent.</p>}
    </form>
  );
}

function ResetCompleteForm({
  onReset,
  resetError,
}: {
  onReset: (token: string, newPassword: string) => Promise<void>;
  resetError: boolean;
}) {
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    void onReset(token, newPassword);
  };
  return (
    <form data-testid="reset-complete-form" onSubmit={handleSubmit}>
      <input
        data-testid="reset-token"
        type="text"
        placeholder="Reset token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        required
      />
      <label htmlFor="new-password">New password</label>
      <input
        id="new-password"
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        required
      />
      <button type="submit">Complete reset</button>
      {resetError && <div data-testid="reset-error">Reset link is invalid or expired.</div>}
    </form>
  );
}

function OnboardingForm({
  onComplete,
  retryable,
  showTimezoneWarning,
}: {
  onComplete: (input: {
    defaultCurrency: string;
    locale: string;
    privacyNoticeVersion: string;
    reportingTimezone: string;
  }) => Promise<void>;
  retryable: boolean;
  showTimezoneWarning: boolean;
}) {
  const [privacyAck, setPrivacyAck] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [locale, setLocale] = useState("en-US");
  const [reportingTimezone, setReportingTimezone] = useState("America/New_York");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!privacyAck) return;
    setSubmitting(true);
    void onComplete({
      defaultCurrency,
      locale,
      privacyNoticeVersion: "1.0",
      reportingTimezone,
    }).finally(() => {
      setSubmitting(false);
    });
  };

  return (
    <form data-testid="onboarding-form" onSubmit={handleSubmit}>
      <div data-testid="privacy-notice">
        <h2>Privacy Notice</h2>
        <p>
          Cashmemo stores your money journal data in an encrypted database. Your data is never
          shared with third parties or used for training. You can export or permanently delete your
          data at any time.
        </p>
        <label>
          <input
            data-testid="privacy-ack"
            type="checkbox"
            checked={privacyAck}
            onChange={(e) => setPrivacyAck(e.target.checked)}
          />
          I acknowledge the privacy notice
        </label>
      </div>

      <label htmlFor="default-currency">Default currency</label>
      <select
        id="default-currency"
        data-testid="default-currency"
        value={defaultCurrency}
        onChange={(e) => setDefaultCurrency(e.target.value)}
      >
        <option value="USD">USD</option>
        <option value="IDR">IDR</option>
        <option value="EUR">EUR</option>
        <option value="GBP">GBP</option>
        <option value="JPY">JPY</option>
      </select>

      <label htmlFor="locale">Locale</label>
      <input
        id="locale"
        data-testid="locale"
        type="text"
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
      />

      <label htmlFor="reporting-timezone">Reporting timezone</label>
      <select
        id="reporting-timezone"
        data-testid="reporting-timezone"
        value={reportingTimezone}
        onChange={(e) => setReportingTimezone(e.target.value)}
      >
        <option value="America/New_York">America/New_York</option>
        <option value="Asia/Tokyo">Asia/Tokyo</option>
        <option value="Asia/Jakarta">Asia/Jakarta</option>
        <option value="Europe/London">Europe/London</option>
        <option value="UTC">UTC</option>
      </select>

      {showTimezoneWarning && (
        <div data-testid="timezone-warning">
          <p>
            Changing your reporting timezone will affect how monthly periods are calculated.
            Existing memos will retain their original timestamps.
          </p>
        </div>
      )}

      {retryable && (
        <div data-testid="onboarding-retryable">
          <p>Something went wrong. Please try again.</p>
        </div>
      )}

      <button type="submit" disabled={!privacyAck || submitting}>
        Complete onboarding
      </button>
    </form>
  );
}
