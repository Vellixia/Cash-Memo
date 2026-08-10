import { useCallback, useEffect, useState, type SyntheticEvent } from "react";

import type { ApiPort, MeView, PreferencesView } from "../../app/api-port.js";

interface OnboardingFlowProps {
  api: ApiPort;
  me: MeView;
}

export function OnboardingFlow({ api, me }: OnboardingFlowProps) {
  const [privacyAck, setPrivacyAck] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [locale, setLocale] = useState("en-US");
  const [reportingTimezone, setReportingTimezone] = useState("America/New_York");
  const [submitting, setSubmitting] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [showTimezoneWarning, setShowTimezoneWarning] = useState(false);
  const [existingPrefs, setExistingPrefs] = useState<PreferencesView | null>(null);

  useEffect(() => {
    if (me.preferences !== null) {
      setExistingPrefs(me.preferences);
      setDefaultCurrency(me.preferences.defaultCurrency);
      setLocale(me.preferences.locale);
      setReportingTimezone(me.preferences.reportingTimezone);
      setShowTimezoneWarning(me.preferences.timezoneBoundaryWarningRequired);
    }
  }, [me]);

  const handleTimezoneChange = useCallback(
    (value: string) => {
      setReportingTimezone(value);
      if (existingPrefs !== null && value !== existingPrefs.reportingTimezone) {
        setShowTimezoneWarning(true);
      } else {
        setShowTimezoneWarning(false);
      }
    },
    [existingPrefs],
  );

  const handleSubmit = useCallback(
    (e: SyntheticEvent) => {
      e.preventDefault();
      if (!privacyAck) return;
      setRetryable(false);
      setSubmitting(true);
      const idempotencyKey = api.generateIdempotencyKey();
      void api
        .completeOnboarding({
          defaultCurrency,
          idempotencyKey,
          locale,
          privacyNoticeVersion: "1.0",
          reportingTimezone,
        })
        .then(() => {
          setSubmitting(false);
        })
        .catch(() => {
          setRetryable(true);
          setSubmitting(false);
        });
    },
    [api, defaultCurrency, locale, privacyAck, reportingTimezone],
  );

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

      <label htmlFor="ob-currency">Default currency</label>
      <select
        id="ob-currency"
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

      <label htmlFor="ob-locale">Locale</label>
      <input
        id="ob-locale"
        data-testid="locale"
        type="text"
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
      />

      <label htmlFor="ob-tz">Reporting timezone</label>
      <select
        id="ob-tz"
        data-testid="reporting-timezone"
        value={reportingTimezone}
        onChange={(e) => handleTimezoneChange(e.target.value)}
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
          <p>Something went wrong. Your input has been preserved. Please try again.</p>
        </div>
      )}

      <button type="submit" disabled={!privacyAck || submitting}>
        Complete onboarding
      </button>
    </form>
  );
}
