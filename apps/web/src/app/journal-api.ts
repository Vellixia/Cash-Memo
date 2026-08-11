export type LabelStatus = "active" | "inactive";

export interface CategoryView {
  readonly id: string;
  readonly kind: "expense" | "income";
  readonly name: string;
  readonly origin: "custom" | "starter";
  readonly revision: string;
  readonly status: LabelStatus;
}

export interface MoneySpaceView {
  readonly id: string;
  readonly name: string;
  readonly origin: "custom" | "starter";
  readonly revision: string;
  readonly status: LabelStatus;
}

export interface SearchFilters {
  readonly categoryIds: readonly string[];
  readonly currencies: readonly string[];
  readonly directions: readonly ("expense" | "income")[];
  readonly from: string | null;
  readonly lifecycles: readonly ("active" | "archived")[];
  readonly moneySpaceIds: readonly string[];
  readonly planningStatuses: readonly ("planned" | "unplanned" | "unspecified")[];
  readonly purposes: readonly ("mixed" | "personal" | "unspecified" | "work")[];
  readonly to: string | null;
}

export interface SearchInput {
  readonly cursor: string | null;
  readonly filters: SearchFilters;
  readonly limit: number;
  readonly query: string | null;
}

export interface SearchItem {
  readonly amountMinor: string;
  readonly categoryId: string | null;
  readonly currencyCode: string;
  readonly direction: "expense" | "income";
  readonly id: string;
  readonly lifecycleState: string;
  readonly moneySpaceId: string | null;
  readonly note: string | null;
  readonly occurredAt: string;
  readonly planningStatus: "planned" | "unplanned" | null;
  readonly purpose: "mixed" | "personal" | "work" | null;
  readonly revision: string;
}

export interface SearchPage {
  readonly items: readonly SearchItem[];
  readonly nextCursor: string | null;
  readonly resultSetVersion: number;
}

export interface OverviewBucket {
  readonly amountMinor: string;
  readonly key: string;
  readonly label: string;
}

export interface CurrentMonthCurrency {
  readonly categoryBreakdown: readonly OverviewBucket[];
  readonly currency: string;
  readonly currencyExponent: number;
  readonly expenseMinor: string;
  readonly incomeMinor: string;
  readonly netMinor: string;
  readonly planningBreakdown: readonly OverviewBucket[];
  readonly purposeBreakdown: readonly OverviewBucket[];
}

export interface CurrentMonthRecentMemo {
  readonly direction: "expense" | "income";
  readonly id: string;
  readonly money: {
    readonly amountMinor: string;
    readonly currency: string;
    readonly currencyExponent: number;
  };
  readonly note: string | null;
  readonly occurrence: { readonly occurredAt: string };
}

export interface CurrentMonthOverviewView {
  readonly calculatedAt: string;
  readonly currencies: readonly CurrentMonthCurrency[];
  readonly period: string;
  readonly recentMemos: readonly CurrentMonthRecentMemo[];
  readonly reportingTimezone: string;
}

export interface MonthlyReviewCurrency {
  readonly currency: string;
  readonly currencyExponent: number;
  readonly expenseMinor: string;
  readonly incomeMinor: string;
  readonly largestExpenseCategories: readonly OverviewBucket[];
  readonly netMinor: string;
  readonly priorMonth: {
    readonly absoluteChangeMinor: string;
    readonly expenseMinor: string;
    readonly percentageChange: string | null;
    readonly percentageUnavailableReason: "PRIOR_VALUE_ZERO" | null;
  };
  readonly unplannedExpenseMinor: string;
}

export interface MonthlyReviewView {
  readonly calculatedAt: string;
  readonly currencies: readonly MonthlyReviewCurrency[];
  readonly month: string;
  readonly priorMonth: string;
  readonly reportingTimezone: string;
}

export interface AssistedDraftView {
  readonly assessments: readonly {
    readonly field?: string;
    readonly reasonCode?: string | null;
    readonly status?: string;
  }[];
  readonly authoritative: false;
  readonly captureStartedAt: string;
  readonly captureTimezone: string;
  readonly expiresAt: string;
  readonly fields: Record<string, unknown>;
  readonly id: string;
  readonly origin: string;
  readonly revision: string;
  readonly sourceCompleteness: string;
  readonly sourceText: string | null;
  readonly status: string;
}

export interface VoiceCaptureView {
  readonly authoritative: false;
  readonly capability: { readonly ai: string; readonly stt: string };
  readonly draftId: string | null;
  readonly errorCode: string | null;
  readonly id: string;
  readonly revision: string;
  readonly state: string;
}

export interface AssistedCaptureApiPort {
  cancelVoiceCapture(id: string, expectedRevision: string): Promise<VoiceCaptureView>;
  confirmDraft(
    id: string,
    input: {
      confirmation: "CONFIRM_MONEY_MEMO";
      expectedRevision: string;
      memo: {
        categoryId: string | null;
        direction: "expense" | "income";
        money: { amount: string; currency: string };
        moneySpaceId: string | null;
        note: string | null;
        occurrence: {
          occurredAt: string;
          occurredLocal: string;
          occurredOffsetMinutes: number;
          occurredTimezone: string;
          timezoneDatabaseVersion: string;
        };
        planningStatus: "planned" | "unplanned" | null;
        purpose: "mixed" | "personal" | "work" | null;
      };
    },
  ): Promise<{ readonly id: string }>;
  extractText(input: {
    captureStartedAt: string;
    captureTimezone: string;
    consent: "SEND_THIS_TEXT_FOR_AI_EXTRACTION";
    text: string;
  }): Promise<{ captureId: string; draft: AssistedDraftView; state: string }>;
  getDraft(id: string): Promise<AssistedDraftView>;
  getVoiceCapture(id: string): Promise<VoiceCaptureView>;
  startVoiceCapture(input: {
    aiConsent: "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION";
    captureStartedAt: string;
    captureTimezone: string;
    detectorLimitationDisclosed: true;
    sttConsent: "SEND_THIS_RECORDING_FOR_TRANSCRIPTION";
  }): Promise<VoiceCaptureView>;
  updateDraft(
    id: string,
    input: {
      candidateFields: Record<string, unknown>;
      expectedRevision: string;
      sourceCompleteness: string;
      sourceText: string | null;
    },
  ): Promise<AssistedDraftView>;
  uploadVoiceAudio(id: string, audio: Blob, idempotencyKey: string): Promise<VoiceCaptureView>;
}

export type JournalErrorCode =
  | "AI_UNAVAILABLE"
  | "ASSISTED_CAPTURE_UNAVAILABLE"
  | "AUDIO_INVALID"
  | "CURRENT_MONTH_CALCULATION_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR"
  | "INVALID_STATE_TRANSITION"
  | "LABEL_CONFLICT"
  | "LABEL_KIND_MISMATCH"
  | "LABEL_NOT_FOUND"
  | "NETWORK_ERROR"
  | "MONTHLY_REVIEW_CALCULATION_UNAVAILABLE"
  | "INVALID_REPORTING_MONTH"
  | "PRIVACY_BOUNDARY_BLOCKED"
  | "RESULTS_CHANGED"
  | "REVISION_CONFLICT"
  | "VALIDATION_ERROR";

export class JournalApiError extends Error {
  constructor(
    readonly code: JournalErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "JournalApiError";
  }
}

export interface JournalApiPort {
  createCategory(input: { kind: "expense" | "income"; name: string }): Promise<CategoryView>;
  createMoneySpace(input: { name: string }): Promise<MoneySpaceView>;
  getCurrentMonth(): Promise<CurrentMonthOverviewView>;
  getMonthlyReview(month: string): Promise<MonthlyReviewView>;
  listCategories(): Promise<readonly CategoryView[]>;
  listMoneySpaces(): Promise<readonly MoneySpaceView[]>;
  search(input: Readonly<SearchInput>): Promise<SearchPage>;
  updateCategory(
    id: string,
    input: { expectedRevision: string; name?: string; status?: LabelStatus },
  ): Promise<CategoryView>;
  updateMoneySpace(
    id: string,
    input: { expectedRevision: string; name?: string; status?: LabelStatus },
  ): Promise<MoneySpaceView>;
  readonly cancelVoiceCapture?: AssistedCaptureApiPort["cancelVoiceCapture"];
  readonly confirmDraft?: AssistedCaptureApiPort["confirmDraft"];
  readonly extractText?: AssistedCaptureApiPort["extractText"];
  readonly getDraft?: AssistedCaptureApiPort["getDraft"];
  readonly getVoiceCapture?: AssistedCaptureApiPort["getVoiceCapture"];
  readonly startVoiceCapture?: AssistedCaptureApiPort["startVoiceCapture"];
  readonly updateDraft?: AssistedCaptureApiPort["updateDraft"];
  readonly uploadVoiceAudio?: AssistedCaptureApiPort["uploadVoiceAudio"];
}

const API_BASE = "/api/v1";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new JournalApiError("NETWORK_ERROR", true);
  }
  const body =
    response.status === 204 ? null : ((await response.json()) as Record<string, unknown>);
  if (!response.ok) {
    const rawCode = body?.["messageCode"];
    const code = typeof rawCode === "string" ? (rawCode as JournalErrorCode) : "INTERNAL_ERROR";
    throw new JournalApiError(code, response.status >= 500);
  }
  return body as T;
}

function json(body: unknown): Pick<RequestInit, "body" | "headers"> {
  return { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
}

export function createJournalApi(): JournalApiPort {
  return {
    async createCategory(input) {
      return request<CategoryView>(`${API_BASE}/categories`, {
        ...json(input),
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        method: "POST",
      });
    },
    async createMoneySpace(input) {
      return request<MoneySpaceView>(`${API_BASE}/money-spaces`, {
        ...json(input),
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        method: "POST",
      });
    },
    async cancelVoiceCapture(id, expectedRevision) {
      return request<VoiceCaptureView>(`${API_BASE}/voice-captures/${id}`, {
        ...json({ expectedRevision }),
        method: "DELETE",
      });
    },
    async confirmDraft(id, input) {
      return request<{ readonly id: string }>(`${API_BASE}/drafts/${id}/confirm`, {
        ...json(input),
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        method: "POST",
      });
    },
    async extractText(input) {
      return request(`${API_BASE}/drafts/text-extraction`, { ...json(input), method: "POST" });
    },
    async getDraft(id) {
      return request<AssistedDraftView>(`${API_BASE}/drafts/${id}`, { cache: "no-store" });
    },
    async getVoiceCapture(id) {
      return request<VoiceCaptureView>(`${API_BASE}/voice-captures/${id}`, { cache: "no-store" });
    },
    async getCurrentMonth() {
      return request<CurrentMonthOverviewView>(`${API_BASE}/overview/current-month`, {
        cache: "no-store",
      });
    },
    async getMonthlyReview(month) {
      return request<MonthlyReviewView>(
        `${API_BASE}/reviews/monthly/${encodeURIComponent(month)}`,
        {
          cache: "no-store",
        },
      );
    },
    async listCategories() {
      return request<readonly CategoryView[]>(`${API_BASE}/categories`);
    },
    async listMoneySpaces() {
      return request<readonly MoneySpaceView[]>(`${API_BASE}/money-spaces`);
    },
    async search(input) {
      return request<SearchPage>(`${API_BASE}/memos/search`, {
        ...json(input),
        method: "POST",
      });
    },
    async startVoiceCapture(input) {
      return request<VoiceCaptureView>(`${API_BASE}/voice-captures`, {
        ...json(input),
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        method: "POST",
      });
    },
    async updateDraft(id, input) {
      return request<AssistedDraftView>(`${API_BASE}/drafts/${id}`, {
        ...json(input),
        method: "PATCH",
      });
    },
    async updateCategory(id, input) {
      return request<CategoryView>(`${API_BASE}/categories/${id}`, {
        ...json(input),
        method: "PATCH",
      });
    },
    async updateMoneySpace(id, input) {
      return request<MoneySpaceView>(`${API_BASE}/money-spaces/${id}`, {
        ...json(input),
        method: "PATCH",
      });
    },
    async uploadVoiceAudio(id, audio, idempotencyKey) {
      return request<VoiceCaptureView>(`${API_BASE}/voice-captures/${id}/audio`, {
        body: audio,
        headers: { "Content-Type": audio.type, "Idempotency-Key": idempotencyKey },
        method: "PUT",
      });
    },
  };
}
