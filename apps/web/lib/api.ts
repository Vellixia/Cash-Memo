export type User = { id: string; email: string };
export type Direction = "income" | "expense";
export type Memo = {
  id: string;
  direction: Direction;
  amount_minor: number;
  currency: string;
  occurred_at: string;
  category_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};
export type Category = { id: string; name: string; direction: Direction; emoji: string | null };
export type SummaryTotal = { currency: string; direction: Direction; total_minor: number };
export type CategoryTotal = {
  category_id: string | null;
  currency: string;
  direction: Direction;
  total_minor: number;
};
export type Summary = { month: string; totals: SummaryTotal[]; by_category: CategoryTotal[] };

export type MemoInput = {
  direction: Direction;
  amount_minor: number;
  currency: string;
  occurred_at: string;
  category_id?: string | null;
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

export function getMemos(month: string, categoryId?: string): Promise<Memo[]> {
  const params = new URLSearchParams({ month, offset: String(utcOffsetMinutes()) });
  if (categoryId) params.set("category_id", categoryId);
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

// --- auth -----------------------------------------------------------------

export function getMe(): Promise<User> {
  return api<User>("/auth/me");
}

export function login(email: string, password: string): Promise<User> {
  return api<User>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function signup(email: string, password: string): Promise<User> {
  return api<User>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function logout(): Promise<void> {
  return api<void>("/auth/logout", { method: "POST" });
}

// --- money helpers -----------------------------------------------------

function getExponent(currency: string): number {
  try {
    return (
      // Fixed locale: the minor-unit exponent must not depend on the viewer's browser.
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Formats minor units (cents) as a localized currency string, e.g. 1050 -> "$10.50". */
export function formatMoney(amount_minor: number, currency: string): string {
  const exp = getExponent(currency);
  const value = amount_minor / 10 ** exp;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(exp)} ${currency}`;
  }
}

/** Parses a decimal string ("10.5") into minor units (1050) using string math
 * (no float drift) for the currency's exponent. */
export function toMinor(input: string, currency: string): number {
  const exp = getExponent(currency);
  const trimmed = input.trim();
  const negative = trimmed.startsWith("-");
  const digitsOnly = trimmed.replace(/^-/, "").replace(/[^0-9.]/g, "");
  const [intPart, fracPart = ""] = digitsOnly.split(".");
  const frac = (fracPart + "0".repeat(exp)).slice(0, exp);
  const combined = `${intPart || "0"}${frac}` || "0";
  const value = parseInt(combined, 10) || 0;
  return negative ? -value : value;
}

/** Inverse of toMinor: minor units (1050) -> decimal string ("10.50"). */
export function fromMinor(amount_minor: number, currency: string): string {
  const exp = getExponent(currency);
  const negative = amount_minor < 0;
  const abs = Math.abs(amount_minor).toString().padStart(exp + 1, "0");
  if (exp === 0) return `${negative ? "-" : ""}${abs}`;
  const intPart = abs.slice(0, -exp);
  const fracPart = abs.slice(-exp);
  return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}
