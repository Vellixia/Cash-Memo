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

export type JournalErrorCode =
  | "CURRENT_MONTH_CALCULATION_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR"
  | "INVALID_STATE_TRANSITION"
  | "LABEL_CONFLICT"
  | "LABEL_KIND_MISMATCH"
  | "LABEL_NOT_FOUND"
  | "NETWORK_ERROR"
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
    async getCurrentMonth() {
      return request<CurrentMonthOverviewView>(`${API_BASE}/overview/current-month`, {
        cache: "no-store",
      });
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
  };
}
