export type User = { id: string; email: string; default_currency: string };
export type Direction = "income" | "expense";
export type MemoDirection = Direction | "transfer";
export type Memo = {
  id: string;
  direction: MemoDirection;
  amount_minor: number;
  currency: string;
  occurred_at: string;
  category_id: string | null;
  source_id: string | null;
  to_source_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};
export type Category = { id: string; name: string; direction: Direction; emoji: string | null };
export type SourceKind = "cash" | "bank" | "ewallet" | "credit" | "paylater" | "other";
export type Source = {
  id: string;
  name: string;
  kind: SourceKind;
  emoji: string | null;
  track_balance: boolean;
  currency: string | null;
  opening_minor: number;
  archived_at: string | null;
  /** Only for sources that track a balance. */
  balance_minor: number | null;
};
export type SummaryTotal = { currency: string; direction: Direction; total_minor: number };
export type CategoryTotal = {
  category_id: string | null;
  currency: string;
  direction: Direction;
  total_minor: number;
};
export type Summary = { month: string; totals: SummaryTotal[]; by_category: CategoryTotal[] };

export type MemoInput = {
  direction: MemoDirection;
  amount_minor: number;
  currency: string;
  occurred_at: string;
  category_id?: string | null;
  source_id?: string | null;
  to_source_id?: string | null;
  note?: string | null;
};

/** Tiny JSON fetch wrapper. Throws Error with the API's `error` message on failure. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  // A 401 from login/signup means bad credentials: let the form show it instead of redirecting.
  if (res.status === 401 && !path.startsWith("/auth/login") && !path.startsWith("/auth/signup")) {
    if (typeof window !== "undefined") window.location.replace("/login");
    throw new Error("Not logged in");
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** The user's UTC offset in minutes east of UTC, so the API can apply month
 * boundaries in local time. Sent on every /memos and /summary read. */
export function utcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export function getMemos(month: string, categoryId?: string, sourceId?: string): Promise<Memo[]> {
  const params = new URLSearchParams({ month, offset: String(utcOffsetMinutes()) });
  if (categoryId) params.set("category_id", categoryId);
  if (sourceId) params.set("source_id", sourceId);
  return api<Memo[]>(`/memos?${params}`);
}

export function getSummary(month: string): Promise<Summary> {
  const params = new URLSearchParams({ month, offset: String(utcOffsetMinutes()) });
  return api<Summary>(`/summary?${params}`);
}

// --- memos --------------------------------------------------------------

export function getMemo(id: string): Promise<Memo> {
  return api<Memo>(`/memos/${id}`);
}

export function createMemo(input: MemoInput): Promise<Memo> {
  return api<Memo>("/memos", { method: "POST", body: JSON.stringify(input) });
}

export function updateMemo(id: string, input: Partial<MemoInput>): Promise<Memo> {
  return api<Memo>(`/memos/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteMemo(id: string): Promise<void> {
  return api<void>(`/memos/${id}`, { method: "DELETE" });
}

export function restoreMemo(id: string): Promise<Memo> {
  return api<Memo>(`/memos/${id}/restore`, { method: "POST" });
}

/** `before` is the previous page's last row, "<occurred_at>,<id>" (see `searchCursor`). */
export function searchMemos(q: string, before?: string): Promise<Memo[]> {
  const params = new URLSearchParams({ q });
  if (before) params.set("before", before);
  return api<Memo[]>(`/search?${params}`);
}

export const SEARCH_PAGE_SIZE = 50;

export function searchCursor(m: Memo): string {
  return `${m.occurred_at},${m.id}`;
}

// --- categories -----------------------------------------------------------

export function getCategories(): Promise<Category[]> {
  return api<Category[]>("/categories");
}

export type CategoryInput = { name: string; direction: Direction; emoji?: string | null };

export function createCategory(input: CategoryInput): Promise<Category> {
  return api<Category>("/categories", { method: "POST", body: JSON.stringify(input) });
}

/** PATCH is partial; `emoji: null` clears it. */
export function updateCategory(id: string, patch: { name?: string; emoji?: string | null }): Promise<Category> {
  return api<Category>(`/categories/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteCategory(id: string): Promise<void> {
  return api<void>(`/categories/${id}`, { method: "DELETE" });
}

// --- sources ----------------------------------------------------------------

export function getSources(): Promise<Source[]> {
  return api<Source[]>("/sources");
}

export type SourceInput = {
  name: string;
  kind: SourceKind;
  emoji?: string | null;
  track_balance?: boolean;
  currency?: string | null;
  opening_minor?: number;
};

export function createSource(input: SourceInput): Promise<Source> {
  return api<Source>("/sources", { method: "POST", body: JSON.stringify(input) });
}

/** PATCH is partial; `archived: true/false` archives/restores. The response has no `balance_minor`. */
export function updateSource(id: string, patch: Partial<SourceInput> & { archived?: boolean }): Promise<Source> {
  return api<Source>(`/sources/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** Archives (the API never hard-deletes a source, so history and balances stay intact). */
export function archiveSource(id: string): Promise<void> {
  return api<void>(`/sources/${id}`, { method: "DELETE" });
}

// --- auth -----------------------------------------------------------------

export function getMe(): Promise<User> {
  return api<User>("/auth/me");
}

export function login(email: string, password: string): Promise<User> {
  return api<User>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function signup(email: string, password: string, default_currency?: string): Promise<User> {
  return api<User>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password, default_currency }) });
}

export function updateMe(patch: { default_currency: string }): Promise<User> {
  return api<User>("/auth/me", { method: "PATCH", body: JSON.stringify(patch) });
}

export function logout(): Promise<void> {
  return api<void>("/auth/logout", { method: "POST" });
}

export function requestPasswordReset(email: string): Promise<void> {
  return api<void>("/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email }) });
}

export function completePasswordReset(token: string, password: string): Promise<void> {
  return api<void>("/auth/password-reset/complete", { method: "POST", body: JSON.stringify({ token, password }) });
}

export function changePassword(current_password: string, new_password: string): Promise<void> {
  return api<void>("/auth/password", { method: "POST", body: JSON.stringify({ current_password, new_password }) });
}

export function changeEmail(current_password: string, new_email: string): Promise<void> {
  return api<void>("/auth/email", { method: "POST", body: JSON.stringify({ current_password, new_email }) });
}

export function confirmEmail(token: string): Promise<User> {
  return api<User>("/auth/email/confirm", { method: "POST", body: JSON.stringify({ token }) });
}

export function deleteAccount(password: string): Promise<void> {
  return api<void>("/auth/delete", { method: "POST", body: JSON.stringify({ password }) });
}

// --- data: export/import ---------------------------------------------------

export function startExport(): Promise<{ job_id: string }> {
  return api("/exports", { method: "POST", body: JSON.stringify({ offset: utcOffsetMinutes() }) });
}

export function startImportUpload(): Promise<{ import_id: string; upload_url: string }> {
  return api("/imports", { method: "POST" });
}

/** PUTs the raw file to a presigned S3 URL on another origin: no `/api` prefix, no extra headers. */
export async function uploadImportFile(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": "text/csv" } });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

export type DateOrder = "dmy" | "mdy";

export type Mapping = {
  has_header: boolean;
  date: number;
  amount: number;
  direction?: number | null;
  currency?: number | null;
  category?: number | null;
  source?: number | null;
  to_source?: number | null;
  note?: number | null;
  default_currency: string;
  decimal: "." | ",";
  delimiter: "," | ";" | "\t";
  date_order: DateOrder;
  offset: number;
};

export function startValidate(importId: string, mapping: Mapping): Promise<{ job_id: string }> {
  return api(`/imports/${importId}/validate`, { method: "POST", body: JSON.stringify({ mapping }) });
}

export function startCommit(validateJobId: string): Promise<{ job_id: string }> {
  return api(`/imports/${validateJobId}/commit`, { method: "POST" });
}

export type JobStatus = "queued" | "running" | "done" | "failed";
export type JobError = { line: number; message: string };
export type ExportResult = { rows: number; filename: string };
export type ValidateResult = {
  rows: number;
  valid: number;
  error_count: number;
  errors: JobError[];
  duplicates: number;
  new_categories: string[];
  new_sources: string[];
  currencies: Record<string, number>;
  committed: boolean;
};
export type CommitResult = { inserted: number; duplicates: number };

export type Job<R = ExportResult | ValidateResult | CommitResult | undefined> = {
  id: string;
  kind: string;
  status: JobStatus;
  result: R | null;
  error: string | null;
  download_url: string | null;
};

export function getJob<R = ExportResult | ValidateResult | CommitResult | undefined>(id: string): Promise<Job<R>> {
  return api(`/jobs/${id}`);
}
