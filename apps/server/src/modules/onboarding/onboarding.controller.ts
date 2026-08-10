import type { OnboardingService } from "./onboarding.service.js";
import type { SessionService } from "../identity/session.service.js";

export interface OnboardingControllerDeps {
  onboarding: OnboardingService;
  sessions: SessionService;
}

export function createOnboardingController(deps: Readonly<OnboardingControllerDeps>) {
  return {
    async getMe(requestHeaders: Headers) {
      const ctx = await deps.sessions.authenticate(requestHeaders);
      if (ctx === null) throw new Error("UNAUTHENTICATED");
      const profile = await deps.onboarding.getProfile(ctx.accountId);
      const preferences = await deps.onboarding.getPreferences(ctx.accountId);
      return {
        accountId: ctx.accountId,
        onboardingState: profile.onboardingState,
        preferences:
          preferences === null
            ? null
            : {
                defaultCurrency: preferences.defaultCurrency,
                locale: preferences.locale,
                reportingTimezone: preferences.reportingTimezone,
                revision: preferences.revision,
              },
        privacyNoticeAcceptedAt: profile.privacyNoticeAcceptedAt,
        privacyNoticeVersion: profile.privacyNoticeVersion,
      };
    },

    async completeOnboarding(requestHeaders: Headers, body: { privacyNoticeVersion: string }) {
      const ctx = await deps.sessions.authenticate(requestHeaders);
      if (ctx === null) throw new Error("UNAUTHENTICATED");
      await deps.onboarding.completeOnboarding(ctx.accountId, body.privacyNoticeVersion);
      await deps.onboarding.seedStarterLabels(ctx.accountId);
      return this.getMe(requestHeaders);
    },

    async getPreferences(requestHeaders: Headers) {
      const ctx = await deps.sessions.authenticate(requestHeaders);
      if (ctx === null) throw new Error("UNAUTHENTICATED");
      const preferences = await deps.onboarding.getPreferences(ctx.accountId);
      if (preferences === null) throw new Error("PREFERENCES_NOT_SET");
      return {
        defaultCurrency: preferences.defaultCurrency,
        locale: preferences.locale,
        reportingTimezone: preferences.reportingTimezone,
        revision: preferences.revision,
      };
    },

    async updatePreferences(
      requestHeaders: Headers,
      body: {
        defaultCurrency?: string;
        expectedRevision: string;
        locale?: string;
        reportingTimezone?: string;
      },
    ) {
      const ctx = await deps.sessions.authenticate(requestHeaders);
      if (ctx === null) throw new Error("UNAUTHENTICATED");
      const current = await deps.onboarding.getPreferences(ctx.accountId);
      if (current === null) throw new Error("PREFERENCES_NOT_SET");
      if (current.revision !== body.expectedRevision) throw new Error("REVISION_CONFLICT");
      const updated = await deps.onboarding.setPreferences(ctx.accountId, {
        defaultCurrency: body.defaultCurrency ?? current.defaultCurrency,
        locale: body.locale ?? current.locale,
        reportingTimezone: body.reportingTimezone ?? current.reportingTimezone,
      });
      return {
        defaultCurrency: updated.defaultCurrency,
        locale: updated.locale,
        reportingTimezone: updated.reportingTimezone,
        revision: updated.revision,
      };
    },
  };
}
