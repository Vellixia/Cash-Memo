import { createHash } from "node:crypto";

export interface TraversalQuery {
  readonly lifecycle: "active" | "archived" | "all_non_deleted";
  readonly directions: readonly ("income" | "expense")[];
  readonly categoryIds: readonly string[];
  readonly moneySpaceIds: readonly string[];
  readonly purposes: readonly ("personal" | "work" | "mixed" | "unspecified")[];
  readonly planningStatuses: readonly ("planned" | "unplanned" | "unspecified")[];
  readonly currencies: readonly string[];
  readonly from: string | null;
  readonly to: string | null;
  readonly searchQuery: string | null;
}

function canonicalizeArray(arr: readonly string[]): string {
  return [...arr].sort().join(",");
}

function canonicalizeEnumArray(arr: readonly string[]): string {
  return [...arr].sort().join(",");
}

export function canonicalizeQuery(query: Readonly<TraversalQuery>): string {
  const canonical = {
    categoryIds: canonicalizeArray(query.categoryIds),
    currencies: canonicalizeArray(query.currencies),
    directions: canonicalizeEnumArray(query.directions),
    from: query.from ?? "",
    lifecycle: query.lifecycle,
    moneySpaceIds: canonicalizeArray(query.moneySpaceIds),
    planningStatuses: canonicalizeEnumArray(query.planningStatuses),
    purposes: canonicalizeEnumArray(query.purposes),
    searchQuery: query.searchQuery ?? "",
    to: query.to ?? "",
  };
  const keys = Object.keys(canonical).sort();
  const pairs = keys.map((k) => `${k}=${canonical[k as keyof typeof canonical]}`);
  return pairs.join("&");
}

export function computeQueryFingerprint(query: Readonly<TraversalQuery>): string {
  const canonical = canonicalizeQuery(query);
  return createHash("sha256").update(canonical).digest("hex");
}

export function fingerprintsMatch(first: string, second: string): boolean {
  return first === second;
}
