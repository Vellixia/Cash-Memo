// Generated from the authoritative Cashmemo OpenAPI contract. Do not edit.

export type ClientOptions = {
  baseUrl: `${string}://${string}/api/v1` | (string & {});
};

export type Instant = string;

export type LocalDateTime = string;

/**
 * Canonical IANA time-zone identifier.
 */
export type Timezone = string;

/**
 * Monotonic positive integer serialized as a string.
 */
export type Revision = string;

export type CurrencyCode = string;

export type MinorUnits = string;

/**
 * Positive canonical decimal after currency validation; JSON numbers forbidden.
 */
export type DecimalAmount = string;

export type Direction = "income" | "expense";

export type Purpose = "personal" | "work" | "mixed" | null;

export type PlanningStatus = "planned" | "unplanned" | null;

export type MemoLifecycle = "active" | "archived";

export type HistoryLifecycle = "active" | "archived" | "all_non_deleted";

export type LabelStatus = "active" | "inactive";

export type ReauthScope = "export" | "purge" | "account_delete" | "sessions" | "preferences";

export type Money = {
  amount: DecimalAmount;
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  currencyExponent: number;
  currencyRegistryVersion: string;
};

export type MoneyInput = {
  amount: DecimalAmount;
  currency: CurrencyCode;
};

export type Occurrence = {
  occurredAt: Instant;
  occurredLocal: LocalDateTime;
  occurredTimezone: Timezone;
  occurredOffsetMinutes: number;
  timezoneDatabaseVersion: string;
};

export type OccurrenceInput = {
  occurredAt: Instant;
  occurredLocal: LocalDateTime;
  occurredTimezone: Timezone;
  occurredOffsetMinutes: number;
};

export type SignUpRequest = {
  email: string;
  password: string;
  idempotencyKey: string;
};

export type EmailRequest = {
  email: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type GenericAuthAccepted = {
  status: "accepted";
  messageCode: "CHECK_EMAIL_IF_ELIGIBLE";
};

export type SessionView = {
  sessionId: string;
  userId: string;
  createdAt: Instant;
  idleExpiresAt: Instant;
  absoluteExpiresAt: Instant;
};

export type PreferenceInput = {
  defaultCurrency: CurrencyCode;
  reportingTimezone: Timezone;
  locale: string;
};

export type OnboardingRequest = PreferenceInput & {
  privacyNoticeVersion: string;
};

export type PreferencesView = PreferenceInput & {
  revision: Revision;
  timezoneBoundaryWarningRequired: boolean;
};

export type MeView = {
  userId: string;
  emailVerified: boolean;
  accountStatus: "pending_verification" | "active" | "deletion_grace" | "purging" | "locked";
  onboardingState: "not_started" | "in_progress" | "complete";
  profileRevision: Revision;
  preferences: PreferencesView | null;
};

export type MoneyMemoInputBase = {
  direction: Direction;
  money: MoneyInput;
  occurrence: OccurrenceInput;
  categoryId: string | null;
  moneySpaceId: string | null;
  purpose: Purpose;
  planningStatus: PlanningStatus;
  note: string | null;
};

export type MoneyMemoInput = MoneyMemoInputBase;

export type ManualMemoConfirmRequest = MoneyMemoInputBase & {
  confirmation: "CONFIRM_MONEY_MEMO";
};

export type MoneyMemoUpdate = MoneyMemoInputBase & {
  expectedRevision: Revision;
};

export type MoneyMemoBase = {
  authoritative: true;
  id: string;
  direction: Direction;
  money: Money;
  occurrence: Occurrence;
  categoryId: string | null;
  moneySpaceId: string | null;
  purpose: Purpose;
  planningStatus: PlanningStatus;
  note: string | null;
  origin: "manual" | "natural_language" | "voice";
  revision: Revision;
  createdAt: Instant;
  updatedAt: Instant;
};

export type MoneyMemo = MoneyMemoBase & {
  lifecycle: MemoLifecycle;
};

export type RecentlyDeletedMemo = MoneyMemoBase & {
  lifecycle: "recently_deleted";
  priorLifecycle: "active" | "archived";
  deletedAt: Instant;
  purgeAfter: Instant;
};

export type MemoSearchRequest = {
  query: string | null;
  filters: {
    from: string | null;
    to: string | null;
    directions: Array<Direction>;
    categoryIds: Array<string>;
    moneySpaceIds: Array<string>;
    purposes: Array<"personal" | "work" | "mixed" | "unspecified">;
    planningStatuses: Array<"planned" | "unplanned" | "unspecified">;
    currencies: Array<CurrencyCode>;
    lifecycles: Array<"active" | "archived">;
  };
  /**
   * Opaque authenticated continuation; server rejects query/filter or result-set-version mismatch.
   */
  cursor: string | null;
  limit: number;
};

export type MemoPage = {
  items: Array<MoneyMemo>;
  nextCursor: string | null;
  resultSetVersion: Revision;
};

export type RecentlyDeletedPage = {
  items: Array<RecentlyDeletedMemo>;
  nextCursor: string | null;
  resultSetVersion: Revision;
};

export type DraftCreateRequest = {
  origin: "manual" | "natural_language" | "voice";
  sourceText: string | null;
  sourceCompleteness: "complete" | "incomplete" | "not_applicable";
  fields: MoneyMemoDraftFields;
  captureStartedAt: Instant;
  captureTimezone: Timezone;
};

export type DraftUpdateRequest = {
  expectedRevision: Revision;
  sourceText: string | null;
  sourceCompleteness: "complete" | "incomplete" | "not_applicable";
  fields: MoneyMemoDraftFields;
};

export type MoneyMemoDraftFields = {
  direction: "income" | "expense" | null;
  amount: string | null;
  currency: string | null;
  occurredLocal: string | null;
  occurredTimezone: string | null;
  occurredOffsetMinutes: number | null;
  categoryId: string | null;
  moneySpaceId: string | null;
  purpose: Purpose;
  planningStatus: PlanningStatus;
  note: string | null;
};

export type FieldAssessment = {
  field:
    | "direction"
    | "amount"
    | "currency"
    | "occurredLocal"
    | "occurredTimezone"
    | "categoryId"
    | "moneySpaceId"
    | "purpose"
    | "planningStatus"
    | "note";
  source: "user" | "parser" | "stt" | "ai";
  status: "provided" | "inferred" | "uncertain" | "missing" | "contradictory" | "invalid";
  reasonCode:
    | "AMBIGUOUS_AMOUNT"
    | "AMBIGUOUS_DATE"
    | "AMBIGUOUS_DIRECTION"
    | "UNSUPPORTED_CURRENCY"
    | "UNKNOWN_LABEL"
    | "CONTRADICTORY_TEXT"
    | "PROVIDER_OMISSION"
    | null;
};

export type Draft = {
  authoritative: false;
  id: string;
  origin: "manual" | "natural_language" | "voice";
  sourceText: string | null;
  sourceCompleteness: "complete" | "incomplete" | "not_applicable";
  fields: MoneyMemoDraftFields;
  assessments: Array<FieldAssessment>;
  status: "editing" | "processing" | "reviewable" | "blocked" | "failed_recoverable";
  captureStartedAt: Instant;
  captureTimezone: Timezone;
  lastActivityAt: Instant;
  expiresAt: Instant;
  revision: Revision;
};

export type VoiceCapture = {
  authoritative: false;
  id: string;
  state:
    | "recording"
    | "audio_ready"
    | "transcribing"
    | "transcript_review"
    | "extracting"
    | "draft_review"
    | "correction_required"
    | "failed_recoverable"
    | "canceled";
  draftId: string | null;
  capability: {
    stt: "available" | "degraded" | "unavailable";
    ai: "available" | "degraded" | "unavailable";
  };
  errorCode?:
    | "STT_UNAVAILABLE"
    | "STT_TIMEOUT"
    | "AUDIO_INVALID"
    | "NETWORK_INTERRUPTED"
    | "AI_UNAVAILABLE"
    | "AI_INVALID_OUTPUT"
    | "PRIVACY_BOUNDARY_BLOCKED"
    | null;
  revision: Revision;
  createdAt: Instant;
  audioExpiresAt: string | null;
};

export type LabelName = string;

export type Category = {
  id: string;
  kind: Direction;
  name: LabelName;
  origin: "starter" | "custom";
  status: LabelStatus;
  revision: Revision;
};

export type MoneySpace = {
  id: string;
  name: LabelName;
  origin: "starter" | "custom";
  status: LabelStatus;
  revision: Revision;
};

export type LabelUpdate = {
  expectedRevision: Revision;
  name?: LabelName;
  status?: LabelStatus;
};

export type RevisionRequest = {
  expectedRevision: Revision;
};

export type CurrencyTotals = {
  currency: CurrencyCode;
  currencyExponent: number;
  incomeMinor: string;
  expenseMinor: string;
  netMinor: string;
};

export type BreakdownBucket = {
  key: string;
  label: string;
  amountMinor: string;
};

export type CurrencyOverview = CurrencyTotals & {
  categoryBreakdown: Array<BreakdownBucket>;
  planningBreakdown: Array<BreakdownBucket>;
  purposeBreakdown: Array<BreakdownBucket>;
};

export type Overview = {
  period: string;
  reportingTimezone: Timezone;
  currencies: Array<CurrencyOverview>;
  recentMemos: Array<MoneyMemo>;
  calculatedAt: Instant;
};

export type MonthlyCurrencyReview = CurrencyTotals & {
  largestExpenseCategories: Array<BreakdownBucket>;
  unplannedExpenseMinor: string;
  priorMonth: {
    expenseMinor: string;
    absoluteChangeMinor: string;
    percentageChange: string | null;
    percentageUnavailableReason: "PRIOR_VALUE_ZERO" | null;
  };
};

export type MonthlyReview = {
  month: string;
  priorMonth: string;
  reportingTimezone: Timezone;
  currencies: Array<MonthlyCurrencyReview>;
  calculatedAt: Instant;
};

export type ExportJob = {
  id: string;
  schemaVersion: "1.0";
  state:
    "queued" | "running" | "ready" | "failed" | "canceled" | "expired" | "deleting" | "deleted";
  requestedAt: Instant;
  readyAt: string | null;
  expiresAt: string | null;
  deletedAt: string | null;
  failureCode?: "GENERATION_FAILED" | "STORAGE_UNAVAILABLE" | "DELETION_PENDING" | null;
  revision: Revision;
};

export type AccountDeletionView = {
  id: string;
  state:
    "grace" | "canceled" | "purging" | "live_purged" | "provider_pending" | "complete" | "failed";
  requestedAt: Instant;
  graceEndsAt: Instant;
  livePurgeDueAt: string | null;
  livePurgedAt: string | null;
  providerState: "not_started" | "not_required" | "pending" | "confirmed" | "escalated";
  revision: Revision;
};

/**
 * Never contains request content, provider payload, detector value, prompt, transcript, or another user's data.
 */
export type Error = {
  code:
    | "VALIDATION_FAILED"
    | "UNAUTHENTICATED"
    | "AUTH_FAILED"
    | "EMAIL_NOT_VERIFIED"
    | "AUTH_ACTION_INVALID"
    | "REAUTH_REQUIRED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "REVISION_CONFLICT"
    | "RESULTS_CHANGED"
    | "IDEMPOTENCY_CONFLICT"
    | "STATE_CONFLICT"
    | "LABEL_CONFLICT"
    | "PRIVACY_BOUNDARY_BLOCKED"
    | "AUDIO_INVALID"
    | "CAPABILITY_UNAVAILABLE"
    | "CALCULATION_UNAVAILABLE"
    | "EXPORT_NOT_READY"
    | "RATE_LIMITED"
    | "OPERATION_IN_PROGRESS";
  messageCode: string;
  correlationId: string;
  retryable: boolean;
  retryAfterSeconds?: number | null;
  fieldErrors: Array<{
    field: string;
    reason: string;
  }>;
  currentRevision?: Revision | null;
  currentResultSetVersion?: Revision | null;
  restartRequired?: boolean | null;
};

export type ResultsChangedError = Error & {
  code?: "RESULTS_CHANGED";
  messageCode?: "RESULTS_CHANGED_REFRESH_REQUIRED";
  retryable?: false;
  currentResultSetVersion: Revision;
  restartRequired: true;
};

/**
 * Caller-generated UUID; same key/content replays one result, different content conflicts.
 */
export type IdempotencyKey = string;

/**
 * Session-bound short-lived grant; never placed in URL or logs.
 */
export type ReauthGrant = string;

export type MemoId = string;

export type DraftId = string;

export type CaptureId = string;

export type CategoryId = string;

export type MoneySpaceId = string;

export type ExportId = string;

export type SignUpData = {
  body: SignUpRequest;
  path?: never;
  query?: never;
  url: "/auth/sign-up";
};

export type SignUpErrors = {
  /**
   * Schema/domain validation failed; invalid values are not echoed.
   */
  400: Error;
  /**
   * Account/IP scoped abuse control; response reveals no other user activity.
   */
  429: Error;
};

export type SignUpError = SignUpErrors[keyof SignUpErrors];

export type SignUpResponses = {
  /**
   * Generic accepted response; does not reveal prior account existence.
   */
  202: GenericAuthAccepted;
};

export type SignUpResponse = SignUpResponses[keyof SignUpResponses];

export type ResendVerificationData = {
  body: EmailRequest;
  path?: never;
  query?: never;
  url: "/auth/verification/resend";
};

export type ResendVerificationErrors = {
  /**
   * Account/IP scoped abuse control; response reveals no other user activity.
   */
  429: Error;
};

export type ResendVerificationError = ResendVerificationErrors[keyof ResendVerificationErrors];

export type ResendVerificationResponses = {
  /**
   * Enumeration-safe accepted response.
   */
  202: GenericAuthAccepted;
};

export type ResendVerificationResponse =
  ResendVerificationResponses[keyof ResendVerificationResponses];

export type VerifyEmailData = {
  body: {
    token: string;
  };
  path?: never;
  query?: never;
  url: "/auth/verify-email";
};

export type VerifyEmailErrors = {
  /**
   * Token expired, used, or invalid; same public shape.
   */
  400: Error;
};

export type VerifyEmailError = VerifyEmailErrors[keyof VerifyEmailErrors];

export type VerifyEmailResponses = {
  /**
   * Email verified; user must sign in.
   */
  204: void;
};

export type VerifyEmailResponse = VerifyEmailResponses[keyof VerifyEmailResponses];

export type LoginData = {
  body: LoginRequest;
  path?: never;
  query?: never;
  url: "/auth/login";
};

export type LoginErrors = {
  /**
   * Generic credentials failure.
   */
  401: Error;
  /**
   * Verification required; no journal session exists.
   */
  403: Error;
  /**
   * Account/IP scoped abuse control; response reveals no other user activity.
   */
  429: Error;
};

export type LoginError = LoginErrors[keyof LoginErrors];

export type LoginResponses = {
  /**
   * Session cookie set; journal access requires active verified account.
   */
  200: SessionView;
};

export type LoginResponse = LoginResponses[keyof LoginResponses];

export type RequestPasswordResetData = {
  body: EmailRequest;
  path?: never;
  query?: never;
  url: "/auth/password-reset/request";
};

export type RequestPasswordResetErrors = {
  /**
   * Account/IP scoped abuse control; response reveals no other user activity.
   */
  429: Error;
};

export type RequestPasswordResetError =
  RequestPasswordResetErrors[keyof RequestPasswordResetErrors];

export type RequestPasswordResetResponses = {
  /**
   * Enumeration-safe accepted response.
   */
  202: GenericAuthAccepted;
};

export type RequestPasswordResetResponse =
  RequestPasswordResetResponses[keyof RequestPasswordResetResponses];

export type CompletePasswordResetData = {
  body: {
    token: string;
    newPassword: string;
  };
  path?: never;
  query?: never;
  url: "/auth/password-reset/complete";
};

export type CompletePasswordResetErrors = {
  /**
   * Token expired, used, or invalid; same public shape.
   */
  400: Error;
};

export type CompletePasswordResetError =
  CompletePasswordResetErrors[keyof CompletePasswordResetErrors];

export type CompletePasswordResetResponses = {
  /**
   * Password changed and all sessions revoked.
   */
  204: void;
};

export type CompletePasswordResetResponse =
  CompletePasswordResetResponses[keyof CompletePasswordResetResponses];

export type GetSessionData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/session";
};

export type GetSessionErrors = {
  /**
   * Missing, expired, revoked, or invalid session.
   */
  401: Error;
};

export type GetSessionError = GetSessionErrors[keyof GetSessionErrors];

export type GetSessionResponses = {
  /**
   * Current active session.
   */
  200: SessionView;
};

export type GetSessionResponse = GetSessionResponses[keyof GetSessionResponses];

export type LogoutData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/auth/logout";
};

export type LogoutErrors = {
  /**
   * Missing, expired, revoked, or invalid session.
   */
  401: Error;
};

export type LogoutError = LogoutErrors[keyof LogoutErrors];

export type LogoutResponses = {
  /**
   * Current session revoked and cookie cleared.
   */
  204: void;
};

export type LogoutResponse = LogoutResponses[keyof LogoutResponses];

export type ReauthenticateData = {
  body: {
    password: string;
    scopes: Array<ReauthScope>;
  };
  path?: never;
  query?: never;
  url: "/auth/reauthenticate";
};

export type ReauthenticateErrors = {
  /**
   * Generic credentials failure.
   */
  401: Error;
};

export type ReauthenticateError = ReauthenticateErrors[keyof ReauthenticateErrors];

export type ReauthenticateResponses = {
  /**
   * Session-bound grant; destructive grants are single-use.
   */
  200: {
    reauthGrant: string;
    scopes: Array<ReauthScope>;
    expiresAt: Instant;
  };
};

export type ReauthenticateResponse = ReauthenticateResponses[keyof ReauthenticateResponses];

export type RevokeOtherSessionsData = {
  body?: never;
  headers: {
    /**
     * Session-bound short-lived grant; never placed in URL or logs.
     */
    "X-Reauth-Grant": string;
  };
  path?: never;
  query?: never;
  url: "/auth/sessions/revoke-others";
};

export type RevokeOtherSessionsErrors = {
  /**
   * Recent session-bound authentication required.
   */
  401: Error;
};

export type RevokeOtherSessionsError = RevokeOtherSessionsErrors[keyof RevokeOtherSessionsErrors];

export type RevokeOtherSessionsResponses = {
  /**
   * All sessions except current revoked.
   */
  204: void;
};

export type RevokeOtherSessionsResponse =
  RevokeOtherSessionsResponses[keyof RevokeOtherSessionsResponses];

export type GetMeData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/me";
};

export type GetMeErrors = {
  /**
   * Missing, expired, revoked, or invalid session.
   */
  401: Error;
};

export type GetMeError = GetMeErrors[keyof GetMeErrors];

export type GetMeResponses = {
  /**
   * Account/profile state; contains no journal values.
   */
  200: MeView;
};

export type GetMeResponse = GetMeResponses[keyof GetMeResponses];

export type CompleteOnboardingData = {
  body: OnboardingRequest;
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
  };
  path?: never;
  query?: never;
  url: "/me/onboarding";
};

export type CompleteOnboardingErrors = {
  /**
   * Schema/domain validation failed; invalid values are not echoed.
   */
  400: Error;
  /**
   * Same key used with different canonical content; no write.
   */
  409: Error;
};

export type CompleteOnboardingError = CompleteOnboardingErrors[keyof CompleteOnboardingErrors];

export type CompleteOnboardingResponses = {
  /**
   * Onboarding complete; identical retry returns same state.
   */
  200: MeView;
};

export type CompleteOnboardingResponse =
  CompleteOnboardingResponses[keyof CompleteOnboardingResponses];

export type GetPreferencesData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/me/preferences";
};

export type GetPreferencesErrors = {
  /**
   * Missing, expired, revoked, or invalid session.
   */
  401: Error;
};

export type GetPreferencesError = GetPreferencesErrors[keyof GetPreferencesErrors];

export type GetPreferencesResponses = {
  /**
   * Current preferences.
   */
  200: PreferencesView;
};

export type GetPreferencesResponse = GetPreferencesResponses[keyof GetPreferencesResponses];

export type UpdatePreferencesData = {
  body: {
    expectedRevision: Revision;
    defaultCurrency?: CurrencyCode;
    reportingTimezone?: Timezone;
    locale?: string;
  };
  headers: {
    /**
     * Session-bound short-lived grant; never placed in URL or logs.
     */
    "X-Reauth-Grant": string;
  };
  path?: never;
  query?: never;
  url: "/me/preferences";
};

export type UpdatePreferencesErrors = {
  /**
   * Schema/domain validation failed; invalid values are not echoed.
   */
  400: Error;
  /**
   * Stale revision; no write. Reload required.
   */
  409: Error;
};

export type UpdatePreferencesError = UpdatePreferencesErrors[keyof UpdatePreferencesErrors];

export type UpdatePreferencesResponses = {
  /**
   * Updated preferences; timezone changes include warning code.
   */
  200: PreferencesView;
};

export type UpdatePreferencesResponse =
  UpdatePreferencesResponses[keyof UpdatePreferencesResponses];

export type CancelAccountDeletionData = {
  body: {
    expectedRevision: Revision;
  };
  path?: never;
  query?: never;
  url: "/me/account-deletion";
};

export type CancelAccountDeletionErrors = {
  /**
   * Invalid lifecycle transition; no write.
   */
  409: Error;
};

export type CancelAccountDeletionError =
  CancelAccountDeletionErrors[keyof CancelAccountDeletionErrors];

export type CancelAccountDeletionResponses = {
  /**
   * Grace-period deletion canceled and account reactivated.
   */
  204: void;
};

export type CancelAccountDeletionResponse =
  CancelAccountDeletionResponses[keyof CancelAccountDeletionResponses];

export type GetAccountDeletionData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/me/account-deletion";
};

export type GetAccountDeletionErrors = {
  /**
   * Missing or not owned; identical public response.
   */
  404: Error;
};

export type GetAccountDeletionError = GetAccountDeletionErrors[keyof GetAccountDeletionErrors];

export type GetAccountDeletionResponses = {
  /**
   * Current account deletion state.
   */
  200: AccountDeletionView;
};

export type GetAccountDeletionResponse =
  GetAccountDeletionResponses[keyof GetAccountDeletionResponses];

export type RequestAccountDeletionData = {
  body: {
    confirmation: "DELETE_MY_CASHMEMO_ACCOUNT";
  };
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
    /**
     * Session-bound short-lived grant; never placed in URL or logs.
     */
    "X-Reauth-Grant": string;
  };
  path?: never;
  query?: never;
  url: "/me/account-deletion";
};

export type RequestAccountDeletionErrors = {
  /**
   * Recent session-bound authentication required.
   */
  401: Error;
  /**
   * Invalid lifecycle transition; no write.
   */
  409: Error;
};

export type RequestAccountDeletionError =
  RequestAccountDeletionErrors[keyof RequestAccountDeletionErrors];

export type RequestAccountDeletionResponses = {
  /**
   * Seven-day grace started; journal access suspended.
   */
  202: AccountDeletionView;
};

export type RequestAccountDeletionResponse =
  RequestAccountDeletionResponses[keyof RequestAccountDeletionResponses];

export type ListMemosData = {
  body?: never;
  path?: never;
  query?: {
    /**
     * Opaque authenticated continuation bound to result-set version and canonical list state.
     */
    cursor?: string;
    limit?: number;
    lifecycle?: HistoryLifecycle;
  };
  url: "/memos";
};

export type ListMemosErrors = {
  /**
   * Cursor result-set version or canonical query/filter binding is obsolete. No page is returned; restartRequired is true. Purged/inaccessible data is never replayed.
   */
  409: ResultsChangedError;
};

export type ListMemosError = ListMemosErrors[keyof ListMemosErrors];

export type ListMemosResponses = {
  /**
   * Version-bound stable keyset page ordered by occurrence then immutable ID.
   */
  200: MemoPage;
};

export type ListMemosResponse = ListMemosResponses[keyof ListMemosResponses];

export type ConfirmManualMemoData = {
  body: ManualMemoConfirmRequest;
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
  };
  path?: never;
  query?: never;
  url: "/memos";
};

export type ConfirmManualMemoErrors = {
  /**
   * Schema/domain validation failed; invalid values are not echoed.
   */
  400: Error;
  /**
   * Same key used with different canonical content; no write.
   */
  409: Error;
};

export type ConfirmManualMemoError = ConfirmManualMemoErrors[keyof ConfirmManualMemoErrors];

export type ConfirmManualMemoResponses = {
  /**
   * Explicitly confirmed authoritative Money Memo.
   */
  201: MoneyMemo;
};

export type ConfirmManualMemoResponse =
  ConfirmManualMemoResponses[keyof ConfirmManualMemoResponses];

export type SearchMemosData = {
  body: MemoSearchRequest;
  path?: never;
  query?: never;
  url: "/memos/search";
};

export type SearchMemosErrors = {
  /**
   * Schema/domain validation failed; invalid values are not echoed.
   */
  400: Error;
  /**
   * Cursor result-set version or canonical query/filter binding is obsolete. No page is returned; restartRequired is true. Purged/inaccessible data is never replayed.
   */
  409: ResultsChangedError;
};

export type SearchMemosError = SearchMemosErrors[keyof SearchMemosErrors];

export type SearchMemosResponses = {
  /**
   * Intersection-filtered, version-bound stable keyset page.
   */
  200: MemoPage;
};

export type SearchMemosResponse = SearchMemosResponses[keyof SearchMemosResponses];

export type GetMemoData = {
  body?: never;
  path: {
    memoId: string;
  };
  query?: never;
  url: "/memos/{memoId}";
};

export type GetMemoErrors = {
  /**
   * Missing or not owned; identical public response.
   */
  404: Error;
};

export type GetMemoError = GetMemoErrors[keyof GetMemoErrors];

export type GetMemoResponses = {
  /**
   * Owned authoritative memo.
   */
  200: MoneyMemo;
};

export type GetMemoResponse = GetMemoResponses[keyof GetMemoResponses];

export type UpdateMemoData = {
  body: MoneyMemoUpdate;
  path: {
    memoId: string;
  };
  query?: never;
  url: "/memos/{memoId}";
};

export type UpdateMemoErrors = {
  /**
   * Schema/domain validation failed; invalid values are not echoed.
   */
  400: Error;
  /**
   * Missing or not owned; identical public response.
   */
  404: Error;
  /**
   * Stale revision; no write. Reload required.
   */
  409: Error;
};

export type UpdateMemoError = UpdateMemoErrors[keyof UpdateMemoErrors];

export type UpdateMemoResponses = {
  /**
   * Current authoritative values replaced; revision incremented.
   */
  200: MoneyMemo;
};

export type UpdateMemoResponse = UpdateMemoResponses[keyof UpdateMemoResponses];

export type RestoreArchivedMemoData = {
  body: RevisionRequest;
  path: {
    memoId: string;
  };
  query?: never;
  url: "/memos/{memoId}/archive";
};

export type RestoreArchivedMemoErrors = {
  /**
   * Invalid state or stale revision; no write.
   */
  409: Error;
};

export type RestoreArchivedMemoError = RestoreArchivedMemoErrors[keyof RestoreArchivedMemoErrors];

export type RestoreArchivedMemoResponses = {
  /**
   * Restored to active.
   */
  200: MoneyMemo;
};

export type RestoreArchivedMemoResponse =
  RestoreArchivedMemoResponses[keyof RestoreArchivedMemoResponses];

export type ArchiveMemoData = {
  body: RevisionRequest;
  path: {
    memoId: string;
  };
  query?: never;
  url: "/memos/{memoId}/archive";
};

export type ArchiveMemoErrors = {
  /**
   * Invalid state or stale revision; no write.
   */
  409: Error;
};

export type ArchiveMemoError = ArchiveMemoErrors[keyof ArchiveMemoErrors];

export type ArchiveMemoResponses = {
  /**
   * Archived; still included in deterministic aggregates.
   */
  200: MoneyMemo;
};

export type ArchiveMemoResponse = ArchiveMemoResponses[keyof ArchiveMemoResponses];

export type RestoreRecentlyDeletedMemoData = {
  body: RevisionRequest;
  path: {
    memoId: string;
  };
  query?: never;
  url: "/memos/{memoId}/recently-deleted";
};

export type RestoreRecentlyDeletedMemoErrors = {
  /**
   * Invalid state or stale revision; no write.
   */
  409: Error;
};

export type RestoreRecentlyDeletedMemoError =
  RestoreRecentlyDeletedMemoErrors[keyof RestoreRecentlyDeletedMemoErrors];

export type RestoreRecentlyDeletedMemoResponses = {
  /**
   * Restored to prior active or archived state.
   */
  200: MoneyMemo;
};

export type RestoreRecentlyDeletedMemoResponse =
  RestoreRecentlyDeletedMemoResponses[keyof RestoreRecentlyDeletedMemoResponses];

export type MoveMemoToRecentlyDeletedData = {
  body: RevisionRequest;
  path: {
    memoId: string;
  };
  query?: never;
  url: "/memos/{memoId}/recently-deleted";
};

export type MoveMemoToRecentlyDeletedErrors = {
  /**
   * Invalid state or stale revision; no write.
   */
  409: Error;
};

export type MoveMemoToRecentlyDeletedError =
  MoveMemoToRecentlyDeletedErrors[keyof MoveMemoToRecentlyDeletedErrors];

export type MoveMemoToRecentlyDeletedResponses = {
  /**
   * Hidden from normal views; prior state retained for 30-day restore.
   */
  200: RecentlyDeletedMemo;
};

export type MoveMemoToRecentlyDeletedResponse =
  MoveMemoToRecentlyDeletedResponses[keyof MoveMemoToRecentlyDeletedResponses];

export type PurgeMemoNowData = {
  body: {
    expectedRevision: Revision;
    confirmation: "PURGE_MONEY_MEMO";
  };
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
    /**
     * Session-bound short-lived grant; never placed in URL or logs.
     */
    "X-Reauth-Grant": string;
  };
  path: {
    memoId: string;
  };
  query?: never;
  url: "/memos/{memoId}/purge";
};

export type PurgeMemoNowErrors = {
  /**
   * Recent session-bound authentication required.
   */
  401: Error;
  /**
   * Invalid state or stale revision; no write.
   */
  409: Error;
};

export type PurgeMemoNowError = PurgeMemoNowErrors[keyof PurgeMemoNowErrors];

export type PurgeMemoNowResponses = {
  /**
   * Irreversible purge accepted; live purge due within 24 hours.
   */
  202: unknown;
};

export type ListRecentlyDeletedData = {
  body?: never;
  path?: never;
  query?: {
    /**
     * Opaque authenticated continuation bound to result-set version and recovery-list state.
     */
    cursor?: string;
    limit?: number;
  };
  url: "/recently-deleted";
};

export type ListRecentlyDeletedErrors = {
  /**
   * Cursor result-set version or canonical query/filter binding is obsolete. No page is returned; restartRequired is true. Purged/inaccessible data is never replayed.
   */
  409: ResultsChangedError;
};

export type ListRecentlyDeletedError = ListRecentlyDeletedErrors[keyof ListRecentlyDeletedErrors];

export type ListRecentlyDeletedResponses = {
  /**
   * Dedicated recovery list only.
   */
  200: RecentlyDeletedPage;
};

export type ListRecentlyDeletedResponse =
  ListRecentlyDeletedResponses[keyof ListRecentlyDeletedResponses];

export type ListDraftsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/drafts";
};

export type ListDraftsErrors = {
  /**
   * Missing, expired, revoked, or invalid session.
   */
  401: Error;
};

export type ListDraftsError = ListDraftsErrors[keyof ListDraftsErrors];

export type ListDraftsResponses = {
  /**
   * Recoverable non-authoritative drafts only.
   */
  200: Array<Draft>;
};

export type ListDraftsResponse = ListDraftsResponses[keyof ListDraftsResponses];

export type CreateDraftData = {
  body: DraftCreateRequest;
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
  };
  path?: never;
  query?: never;
  url: "/drafts";
};

export type CreateDraftErrors = {
  /**
   * Same key used with different canonical content; no write.
   */
  409: Error;
  /**
   * Supported detector found a candidate; value is not echoed, persisted, transmitted, or logged.
   */
  422: Error;
};

export type CreateDraftError = CreateDraftErrors[keyof CreateDraftErrors];

export type CreateDraftResponses = {
  /**
   * Non-authoritative recoverable draft.
   */
  201: Draft;
};

export type CreateDraftResponse = CreateDraftResponses[keyof CreateDraftResponses];

export type CreateTextExtractionData = {
  body: {
    text: string;
    captureStartedAt: Instant;
    captureTimezone: Timezone;
    consent: "SEND_THIS_TEXT_FOR_AI_EXTRACTION";
  };
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
  };
  path?: never;
  query?: never;
  url: "/drafts/text-extraction";
};

export type CreateTextExtractionErrors = {
  /**
   * Supported detector found a candidate; value is not echoed, persisted, transmitted, or logged.
   */
  422: Error;
  /**
   * Named STT or AI capability unavailable; manual structured entry remains available.
   */
  503: Error;
};

export type CreateTextExtractionError =
  CreateTextExtractionErrors[keyof CreateTextExtractionErrors];

export type CreateTextExtractionResponses = {
  /**
   * Non-authoritative extraction queued or completed; poll draft.
   */
  202: Draft;
};

export type CreateTextExtractionResponse =
  CreateTextExtractionResponses[keyof CreateTextExtractionResponses];

export type DiscardDraftData = {
  body: RevisionRequest;
  path: {
    draftId: string;
  };
  query?: never;
  url: "/drafts/{draftId}";
};

export type DiscardDraftErrors = {
  /**
   * Stale revision; no write. Reload required.
   */
  409: Error;
};

export type DiscardDraftError = DiscardDraftErrors[keyof DiscardDraftErrors];

export type DiscardDraftResponses = {
  /**
   * Draft inaccessible immediately; cleanup due within 24 hours.
   */
  202: unknown;
};

export type GetDraftData = {
  body?: never;
  path: {
    draftId: string;
  };
  query?: never;
  url: "/drafts/{draftId}";
};

export type GetDraftErrors = {
  /**
   * Missing or not owned; identical public response.
   */
  404: Error;
};

export type GetDraftError = GetDraftErrors[keyof GetDraftErrors];

export type GetDraftResponses = {
  /**
   * Non-authoritative draft.
   */
  200: Draft;
};

export type GetDraftResponse = GetDraftResponses[keyof GetDraftResponses];

export type UpdateDraftData = {
  body: DraftUpdateRequest;
  path: {
    draftId: string;
  };
  query?: never;
  url: "/drafts/{draftId}";
};

export type UpdateDraftErrors = {
  /**
   * Stale draft; no server overwrite. Client must retain conflicting local input for explicit resolution.
   */
  409: Error;
  /**
   * Supported detector found a candidate; value is not echoed, persisted, transmitted, or logged.
   */
  422: Error;
};

export type UpdateDraftError = UpdateDraftErrors[keyof UpdateDraftErrors];

export type UpdateDraftResponses = {
  /**
   * Updated non-authoritative draft.
   */
  200: Draft;
};

export type UpdateDraftResponse = UpdateDraftResponses[keyof UpdateDraftResponses];

export type ExtractEditedDraftTextData = {
  body: {
    expectedRevision: Revision;
    consent: "SEND_THIS_TEXT_FOR_AI_EXTRACTION";
  };
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
  };
  path: {
    draftId: string;
  };
  query?: never;
  url: "/drafts/{draftId}/extract";
};

export type ExtractEditedDraftTextErrors = {
  /**
   * Stale revision; no write. Reload required.
   */
  409: Error;
  /**
   * Supported detector found a candidate; value is not echoed, persisted, transmitted, or logged.
   */
  422: Error;
  /**
   * Named STT or AI capability unavailable; manual structured entry remains available.
   */
  503: Error;
};

export type ExtractEditedDraftTextError =
  ExtractEditedDraftTextErrors[keyof ExtractEditedDraftTextErrors];

export type ExtractEditedDraftTextResponses = {
  /**
   * Extraction started; existing text remains recoverable.
   */
  202: Draft;
};

export type ExtractEditedDraftTextResponse =
  ExtractEditedDraftTextResponses[keyof ExtractEditedDraftTextResponses];

export type ConfirmDraftData = {
  body: {
    expectedRevision: Revision;
    confirmation: "CONFIRM_MONEY_MEMO";
    fields: MoneyMemoInput;
  };
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
  };
  path: {
    draftId: string;
  };
  query?: never;
  url: "/drafts/{draftId}/confirm";
};

export type ConfirmDraftErrors = {
  /**
   * State, revision, or retry identity conflict; no authoritative write.
   */
  409: Error;
};

export type ConfirmDraftError = ConfirmDraftErrors[keyof ConfirmDraftErrors];

export type ConfirmDraftResponses = {
  /**
   * One authoritative memo created; AI/STT fields were revalidated.
   */
  201: MoneyMemo;
};

export type ConfirmDraftResponse = ConfirmDraftResponses[keyof ConfirmDraftResponses];

export type StartVoiceCaptureData = {
  body: {
    captureStartedAt: Instant;
    captureTimezone: Timezone;
    sttConsent: "SEND_THIS_RECORDING_FOR_TRANSCRIPTION";
    aiConsent: "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION";
  };
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
  };
  path?: never;
  query?: never;
  url: "/voice-captures";
};

export type StartVoiceCaptureErrors = {
  /**
   * Schema/domain validation failed; invalid values are not echoed.
   */
  400: Error;
  /**
   * Named STT or AI capability unavailable; manual structured entry remains available.
   */
  503: Error;
};

export type StartVoiceCaptureError = StartVoiceCaptureErrors[keyof StartVoiceCaptureErrors];

export type StartVoiceCaptureResponses = {
  /**
   * Voice capture state; contains no audio URL.
   */
  201: VoiceCapture;
};

export type StartVoiceCaptureResponse =
  StartVoiceCaptureResponses[keyof StartVoiceCaptureResponses];

export type CancelVoiceCaptureData = {
  body: RevisionRequest;
  path: {
    captureId: string;
  };
  query?: never;
  url: "/voice-captures/{captureId}";
};

export type CancelVoiceCaptureErrors = {
  /**
   * Stale revision; no write. Reload required.
   */
  409: Error;
};

export type CancelVoiceCaptureError = CancelVoiceCaptureErrors[keyof CancelVoiceCaptureErrors];

export type CancelVoiceCaptureResponses = {
  /**
   * Capture canceled; raw-audio deletion takes priority.
   */
  202: unknown;
};

export type GetVoiceCaptureData = {
  body?: never;
  path: {
    captureId: string;
  };
  query?: never;
  url: "/voice-captures/{captureId}";
};

export type GetVoiceCaptureErrors = {
  /**
   * Missing or not owned; identical public response.
   */
  404: Error;
};

export type GetVoiceCaptureError = GetVoiceCaptureErrors[keyof GetVoiceCaptureErrors];

export type GetVoiceCaptureResponses = {
  /**
   * Provider-neutral processing state and draft reference.
   */
  200: VoiceCapture;
};

export type GetVoiceCaptureResponse = GetVoiceCaptureResponses[keyof GetVoiceCaptureResponses];

export type UploadVoiceAudioData = {
  body: Blob | File;
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
  };
  path: {
    captureId: string;
  };
  query?: never;
  url: "/voice-captures/{captureId}/audio";
};

export type UploadVoiceAudioErrors = {
  /**
   * Unsupported type, invalid bytes, over 60 seconds, or over 10 MiB; content not echoed.
   */
  400: Error;
  /**
   * Same key used with different canonical content; no write.
   */
  409: Error;
  /**
   * Named STT or AI capability unavailable; manual structured entry remains available.
   */
  503: Error;
};

export type UploadVoiceAudioError = UploadVoiceAudioErrors[keyof UploadVoiceAudioErrors];

export type UploadVoiceAudioResponses = {
  /**
   * Accepted only after server type/size/duration checks; max 60 seconds.
   */
  202: VoiceCapture;
};

export type UploadVoiceAudioResponse = UploadVoiceAudioResponses[keyof UploadVoiceAudioResponses];

export type ListCategoriesData = {
  body?: never;
  path?: never;
  query?: {
    status?: LabelStatus;
    kind?: Direction;
  };
  url: "/categories";
};

export type ListCategoriesErrors = {
  /**
   * Missing, expired, revoked, or invalid session.
   */
  401: Error;
};

export type ListCategoriesError = ListCategoriesErrors[keyof ListCategoriesErrors];

export type ListCategoriesResponses = {
  /**
   * Owned categories.
   */
  200: Array<Category>;
};

export type ListCategoriesResponse = ListCategoriesResponses[keyof ListCategoriesResponses];

export type CreateCategoryData = {
  body: {
    kind: Direction;
    name: LabelName;
  };
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
  };
  path?: never;
  query?: never;
  url: "/categories";
};

export type CreateCategoryErrors = {
  /**
   * Active normalized label name already exists.
   */
  409: Error;
  /**
   * Supported detector found a candidate; value is not echoed, persisted, transmitted, or logged.
   */
  422: Error;
};

export type CreateCategoryError = CreateCategoryErrors[keyof CreateCategoryErrors];

export type CreateCategoryResponses = {
  /**
   * Category created.
   */
  201: Category;
};

export type CreateCategoryResponse = CreateCategoryResponses[keyof CreateCategoryResponses];

export type UpdateCategoryData = {
  body: LabelUpdate;
  path: {
    categoryId: string;
  };
  query?: never;
  url: "/categories/{categoryId}";
};

export type UpdateCategoryErrors = {
  /**
   * Invalid state or stale revision; no write.
   */
  409: Error;
};

export type UpdateCategoryError = UpdateCategoryErrors[keyof UpdateCategoryErrors];

export type UpdateCategoryResponses = {
  /**
   * Renamed/deactivated/restored category.
   */
  200: Category;
};

export type UpdateCategoryResponse = UpdateCategoryResponses[keyof UpdateCategoryResponses];

export type ListMoneySpacesData = {
  body?: never;
  path?: never;
  query?: {
    status?: LabelStatus;
  };
  url: "/money-spaces";
};

export type ListMoneySpacesErrors = {
  /**
   * Missing, expired, revoked, or invalid session.
   */
  401: Error;
};

export type ListMoneySpacesError = ListMoneySpacesErrors[keyof ListMoneySpacesErrors];

export type ListMoneySpacesResponses = {
  /**
   * Owned organizational labels; never accounts/balances.
   */
  200: Array<MoneySpace>;
};

export type ListMoneySpacesResponse = ListMoneySpacesResponses[keyof ListMoneySpacesResponses];

export type CreateMoneySpaceData = {
  body: {
    name: LabelName;
  };
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
  };
  path?: never;
  query?: never;
  url: "/money-spaces";
};

export type CreateMoneySpaceErrors = {
  /**
   * Active normalized label name already exists.
   */
  409: Error;
  /**
   * Supported detector found a candidate; value is not echoed, persisted, transmitted, or logged.
   */
  422: Error;
};

export type CreateMoneySpaceError = CreateMoneySpaceErrors[keyof CreateMoneySpaceErrors];

export type CreateMoneySpaceResponses = {
  /**
   * Money Space created.
   */
  201: MoneySpace;
};

export type CreateMoneySpaceResponse = CreateMoneySpaceResponses[keyof CreateMoneySpaceResponses];

export type UpdateMoneySpaceData = {
  body: LabelUpdate;
  path: {
    moneySpaceId: string;
  };
  query?: never;
  url: "/money-spaces/{moneySpaceId}";
};

export type UpdateMoneySpaceErrors = {
  /**
   * Invalid state or stale revision; no write.
   */
  409: Error;
};

export type UpdateMoneySpaceError = UpdateMoneySpaceErrors[keyof UpdateMoneySpaceErrors];

export type UpdateMoneySpaceResponses = {
  /**
   * Renamed/deactivated/restored Money Space.
   */
  200: MoneySpace;
};

export type UpdateMoneySpaceResponse = UpdateMoneySpaceResponses[keyof UpdateMoneySpaceResponses];

export type GetCurrentMonthOverviewData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/overview/current-month";
};

export type GetCurrentMonthOverviewErrors = {
  /**
   * Missing, expired, revoked, or invalid session.
   */
  401: Error;
  /**
   * Named deterministic section unavailable; no stale/partial values presented as current.
   */
  503: Error;
};

export type GetCurrentMonthOverviewError =
  GetCurrentMonthOverviewErrors[keyof GetCurrentMonthOverviewErrors];

export type GetCurrentMonthOverviewResponses = {
  /**
   * Deterministic currency-partitioned overview in current reporting timezone.
   */
  200: Overview;
};

export type GetCurrentMonthOverviewResponse =
  GetCurrentMonthOverviewResponses[keyof GetCurrentMonthOverviewResponses];

export type GetMonthlyReviewData = {
  body?: never;
  path: {
    month: string;
  };
  query?: never;
  url: "/reviews/monthly/{month}";
};

export type GetMonthlyReviewErrors = {
  /**
   * Missing, expired, revoked, or invalid session.
   */
  401: Error;
  /**
   * Named deterministic section unavailable; no stale/partial values presented as current.
   */
  503: Error;
};

export type GetMonthlyReviewError = GetMonthlyReviewErrors[keyof GetMonthlyReviewErrors];

export type GetMonthlyReviewResponses = {
  /**
   * Deterministic currency-partitioned selected/prior-month comparison.
   */
  200: MonthlyReview;
};

export type GetMonthlyReviewResponse = GetMonthlyReviewResponses[keyof GetMonthlyReviewResponses];

export type ListExportsData = {
  body?: never;
  path?: never;
  query?: never;
  url: "/exports";
};

export type ListExportsErrors = {
  /**
   * Missing, expired, revoked, or invalid session.
   */
  401: Error;
};

export type ListExportsError = ListExportsErrors[keyof ListExportsErrors];

export type ListExportsResponses = {
  /**
   * Current account export jobs.
   */
  200: Array<ExportJob>;
};

export type ListExportsResponse = ListExportsResponses[keyof ListExportsResponses];

export type RequestExportData = {
  body: {
    schemaVersion: "1.0";
    includeRecoverableDrafts: boolean;
  };
  headers: {
    /**
     * Caller-generated UUID; same key/content replays one result, different content conflicts.
     */
    "Idempotency-Key": string;
    /**
     * Session-bound short-lived grant; never placed in URL or logs.
     */
    "X-Reauth-Grant": string;
  };
  path?: never;
  query?: never;
  url: "/exports";
};

export type RequestExportErrors = {
  /**
   * Recent session-bound authentication required.
   */
  401: Error;
  /**
   * Same key used with different canonical content; no write.
   */
  409: Error;
};

export type RequestExportError = RequestExportErrors[keyof RequestExportErrors];

export type RequestExportResponses = {
  /**
   * Idempotent export job accepted.
   */
  202: ExportJob;
};

export type RequestExportResponse = RequestExportResponses[keyof RequestExportResponses];

export type CancelExportData = {
  body: RevisionRequest;
  headers: {
    /**
     * Session-bound short-lived grant; never placed in URL or logs.
     */
    "X-Reauth-Grant": string;
  };
  path: {
    exportId: string;
  };
  query?: never;
  url: "/exports/{exportId}";
};

export type CancelExportErrors = {
  /**
   * Invalid state or stale revision; no write.
   */
  409: Error;
};

export type CancelExportError = CancelExportErrors[keyof CancelExportErrors];

export type CancelExportResponses = {
  /**
   * Export canceled/inaccessible; package deletion queued.
   */
  202: unknown;
};

export type GetExportData = {
  body?: never;
  path: {
    exportId: string;
  };
  query?: never;
  url: "/exports/{exportId}";
};

export type GetExportErrors = {
  /**
   * Missing or not owned; identical public response.
   */
  404: Error;
};

export type GetExportError = GetExportErrors[keyof GetExportErrors];

export type GetExportResponses = {
  /**
   * Export generation/deletion state.
   */
  200: ExportJob;
};

export type GetExportResponse = GetExportResponses[keyof GetExportResponses];

export type DownloadExportData = {
  body?: never;
  headers: {
    /**
     * Session-bound short-lived grant; never placed in URL or logs.
     */
    "X-Reauth-Grant": string;
  };
  path: {
    exportId: string;
  };
  query?: never;
  url: "/exports/{exportId}/download";
};

export type DownloadExportErrors = {
  /**
   * Recent session-bound authentication required.
   */
  401: Error;
  /**
   * Export is not ready, is expired/canceled, or deletion is pending.
   */
  409: Error;
};

export type DownloadExportError = DownloadExportErrors[keyof DownloadExportErrors];

export type DownloadExportResponses = {
  /**
   * Same-origin authenticated stream; internal S3 URL is never exposed.
   */
  200: Blob | File;
};

export type DownloadExportResponse = DownloadExportResponses[keyof DownloadExportResponses];
