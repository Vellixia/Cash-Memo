import type { PrivacyBoundaryPort } from "@cashmemo/privacy-rules";
import type { Pool } from "pg";

import type { CursorCodecOptions } from "./cursor-codec.js";
import type { TraversalQuery } from "./query-fingerprint.js";
import {
  queryContinuation,
  queryFirstPage,
  type TraversalPage,
} from "./versioned-traversal.service.js";

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

export interface SearchRequest {
  readonly cursor: string | null;
  readonly filters: SearchFilters;
  readonly limit: number;
  readonly query: string | null;
}

export interface SearchRepositoryOptions {
  readonly cursorCodec: CursorCodecOptions;
  readonly pool: Pool;
  readonly privacy: PrivacyBoundaryPort;
}

export type SearchErrorCode = "PRIVACY_BOUNDARY_BLOCKED" | "VALIDATION_ERROR";

export class SearchRepositoryError extends Error {
  constructor(readonly code: SearchErrorCode) {
    super(code);
    this.name = "SearchRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const DIRECTIONS = new Set(["expense", "income"]);
const LIFECYCLES = new Set(["active", "archived"]);
const PLANNING_STATUSES = new Set(["planned", "unplanned", "unspecified"]);
const PURPOSES = new Set(["mixed", "personal", "unspecified", "work"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSearchRequest(value: unknown): value is SearchRequest {
  if (!isRecord(value) || !isRecord(value["filters"])) return false;
  const filters = value["filters"];
  return (
    isNullableString(value["cursor"]) &&
    typeof value["limit"] === "number" &&
    isNullableString(value["query"]) &&
    isStringArray(filters["categoryIds"]) &&
    isStringArray(filters["currencies"]) &&
    isStringArray(filters["directions"]) &&
    isNullableString(filters["from"]) &&
    isStringArray(filters["lifecycles"]) &&
    isStringArray(filters["moneySpaceIds"]) &&
    isStringArray(filters["planningStatuses"]) &&
    isStringArray(filters["purposes"]) &&
    isNullableString(filters["to"])
  );
}

function validInstant(value: string | null): boolean {
  return value === null || (!Number.isNaN(Date.parse(value)) && value.includes("T"));
}

function uniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validateRequest(input: unknown): asserts input is SearchRequest {
  if (!isSearchRequest(input)) throw new SearchRepositoryError("VALIDATION_ERROR");
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new SearchRepositoryError("VALIDATION_ERROR");
  }
  if (input.query !== null && (input.query.length < 1 || input.query.length > 200)) {
    throw new SearchRepositoryError("VALIDATION_ERROR");
  }
  if (!validInstant(input.filters.from) || !validInstant(input.filters.to)) {
    throw new SearchRepositoryError("VALIDATION_ERROR");
  }
  if (
    input.filters.from !== null &&
    input.filters.to !== null &&
    Date.parse(input.filters.from) >= Date.parse(input.filters.to)
  ) {
    throw new SearchRepositoryError("VALIDATION_ERROR");
  }
  if (
    !input.filters.categoryIds.every((id) => UUID.test(id)) ||
    !input.filters.moneySpaceIds.every((id) => UUID.test(id)) ||
    !input.filters.currencies.every((currency) => CURRENCY.test(currency)) ||
    !input.filters.directions.every((direction) => DIRECTIONS.has(direction)) ||
    !input.filters.lifecycles.every((state) => LIFECYCLES.has(state)) ||
    !input.filters.planningStatuses.every((status) => PLANNING_STATUSES.has(status)) ||
    !input.filters.purposes.every((purpose) => PURPOSES.has(purpose))
  ) {
    throw new SearchRepositoryError("VALIDATION_ERROR");
  }
  const arrays: readonly (readonly string[])[] = [
    input.filters.categoryIds,
    input.filters.currencies,
    input.filters.directions,
    input.filters.lifecycles,
    input.filters.moneySpaceIds,
    input.filters.planningStatuses,
    input.filters.purposes,
  ];
  if (!arrays.every(uniqueValues)) throw new SearchRepositoryError("VALIDATION_ERROR");
}

function lifecycle(filters: Readonly<SearchFilters>): TraversalQuery["lifecycle"] {
  if (filters.lifecycles.length !== 1) return "all_non_deleted";
  return filters.lifecycles[0] ?? "all_non_deleted";
}

function traversalQuery(input: Readonly<SearchRequest>): TraversalQuery {
  return {
    categoryIds: input.filters.categoryIds,
    currencies: input.filters.currencies,
    directions: input.filters.directions,
    from: input.filters.from,
    lifecycle: lifecycle(input.filters),
    moneySpaceIds: input.filters.moneySpaceIds,
    planningStatuses: input.filters.planningStatuses,
    purposes: input.filters.purposes,
    searchQuery: input.query,
    to: input.filters.to,
  };
}

export class SearchRepository {
  private readonly cursorCodec: CursorCodecOptions;
  private readonly pool: Pool;
  private readonly privacy: PrivacyBoundaryPort;

  constructor(options: Readonly<SearchRepositoryOptions>) {
    this.cursorCodec = options.cursorCodec;
    this.pool = options.pool;
    this.privacy = options.privacy;
  }

  async search(accountId: string, input: unknown): Promise<TraversalPage> {
    validateRequest(input);
    if (input.query !== null) {
      const result = await this.privacy.evaluateText({
        boundary: "search_execution",
        content: input.query,
        ruleSetVersion: "privacy-rules-v1",
      });
      if (result.decision !== "allow") {
        throw new SearchRepositoryError("PRIVACY_BOUNDARY_BLOCKED");
      }
    }
    const query = traversalQuery(input);
    const options = { cursorCodec: this.cursorCodec, pool: this.pool };
    return input.cursor === null
      ? queryFirstPage(this.pool, accountId, query, input.limit, options)
      : queryContinuation(this.pool, accountId, query, input.cursor, input.limit, options);
  }
}
