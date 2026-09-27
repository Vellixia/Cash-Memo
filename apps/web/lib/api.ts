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
