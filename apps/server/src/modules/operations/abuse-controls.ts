import { createHmac } from "node:crypto";

export const abuseOperations = [
  "signup",
  "login",
  "reset",
  "manual_capture",
  "stt",
  "ai_extraction",
  "search",
  "export",
  "deletion",
] as const;
export type AbuseOperation = (typeof abuseOperations)[number];

export function abuseOperationForRequest(method: string, url: string): AbuseOperation | null {
  const path = url.split("?", 1)[0] ?? url;
  const upperMethod = method.toUpperCase();
  if (path.includes("/auth/sign-up")) return "signup";
  if (path.includes("/auth/sign-in")) return "login";
  if (path.includes("password-reset") || path.includes("forgot-password")) return "reset";
  if (upperMethod === "POST" && path === "/api/v1/memos") return "manual_capture";
  if (path.includes("/voice-captures") && upperMethod !== "GET") return "stt";
  if (path.includes("/drafts/text-extraction")) return "ai_extraction";
  if (path === "/api/v1/memos/search") return "search";
  if (path.startsWith("/api/v1/exports")) return "export";
  if (path.startsWith("/api/v1/account-deletion")) return "deletion";
  return null;
}

interface AbuseRule {
  readonly accountLimit: number;
  readonly globalLimit: number;
  readonly windowMilliseconds: number;
}
const rules: Readonly<Record<AbuseOperation, AbuseRule>> = Object.freeze({
  signup: { accountLimit: 30, globalLimit: 500, windowMilliseconds: 60_000 },
  login: { accountLimit: 10, globalLimit: 1_000, windowMilliseconds: 60_000 },
  reset: { accountLimit: 3, globalLimit: 300, windowMilliseconds: 60_000 },
  manual_capture: { accountLimit: 120, globalLimit: 10_000, windowMilliseconds: 60_000 },
  stt: { accountLimit: 10, globalLimit: 100, windowMilliseconds: 60_000 },
  ai_extraction: { accountLimit: 20, globalLimit: 200, windowMilliseconds: 60_000 },
  search: { accountLimit: 120, globalLimit: 10_000, windowMilliseconds: 60_000 },
  export: { accountLimit: 60, globalLimit: 100, windowMilliseconds: 60_000 },
  deletion: { accountLimit: 5, globalLimit: 100, windowMilliseconds: 60_000 },
});
export interface AbuseDecision {
  readonly allowed: boolean;
  readonly code: "ALLOWED" | "RATE_LIMITED" | "SERVICE_CAPACITY_LIMITED";
  readonly retryAfterSeconds: number | null;
}
interface Counter {
  count: number;
  windowStartedAt: number;
}

export class AbuseControls {
  private readonly counters = new Map<string, Counter>();
  constructor(
    private readonly hmacKey: Buffer,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (hmacKey.length < 32) throw new Error("ABUSE_CONTROL_KEY_TOO_SHORT");
  }
  check(operation: AbuseOperation, opaquePrincipal: string): AbuseDecision {
    const rule = rules[operation];
    const current = this.now().getTime();
    const window = Math.floor(current / rule.windowMilliseconds) * rule.windowMilliseconds;
    const principal = createHmac("sha256", this.hmacKey).update(opaquePrincipal).digest("hex");
    const account = this.increment(`${operation}:account:${principal}`, window);
    const global = this.increment(`${operation}:global`, window);
    const retryAfterSeconds = Math.ceil((window + rule.windowMilliseconds - current) / 1_000);
    if (global > rule.globalLimit)
      return Object.freeze({ allowed: false, code: "SERVICE_CAPACITY_LIMITED", retryAfterSeconds });
    if (account > rule.accountLimit)
      return Object.freeze({ allowed: false, code: "RATE_LIMITED", retryAfterSeconds });
    return Object.freeze({ allowed: true, code: "ALLOWED", retryAfterSeconds: null });
  }
  private increment(key: string, windowStartedAt: number): number {
    const existing = this.counters.get(key);
    if (existing?.windowStartedAt !== windowStartedAt) {
      this.counters.set(key, { count: 1, windowStartedAt });
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }
}
