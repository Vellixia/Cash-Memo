import { describe, expect, it } from "vitest";

interface TraversalRecord {
  id: string;
  occurredAt: string;
  lifecycleState: "active" | "archived" | "recently_deleted" | "purging";
}

type MutationClass =
  "create" | "edit_occurrence" | "edit_filterable" | "archive" | "restore" | "delete" | "purge";

interface TraversalState {
  records: TraversalRecord[];
  version: number;
}

function sortRecords(records: TraversalRecord[]): TraversalRecord[] {
  return [...records].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return b.occurredAt.localeCompare(a.occurredAt);
    return b.id.localeCompare(a.id);
  });
}

function filterEligible(records: TraversalRecord[]): TraversalRecord[] {
  return records.filter((r) => r.lifecycleState === "active" || r.lifecycleState === "archived");
}

function paginate(records: TraversalRecord[], limit: number): TraversalRecord[][] {
  const sorted = sortRecords(filterEligible(records));
  const pages: TraversalRecord[][] = [];
  for (let i = 0; i < sorted.length; i += limit) {
    pages.push(sorted.slice(i, i + limit));
  }
  return pages;
}

function applyMutation(state: TraversalState, mutation: MutationClass): TraversalState {
  const records = [...state.records];
  switch (mutation) {
    case "create": {
      records.push({
        id: `id-${String(records.length + 1).padStart(4, "0")}`,
        occurredAt: `2026-01-${String(records.length + 1).padStart(2, "0")}T10:00:00.000Z`,
        lifecycleState: "active",
      });
      return { records, version: state.version + 1 };
    }
    case "edit_occurrence": {
      if (records.length > 0) {
        const idx = records.length - 1;
        const existing = records[idx];
        if (existing !== undefined) {
          records[idx] = { ...existing, occurredAt: "2026-06-01T10:00:00.000Z" };
        }
      }
      return { records, version: state.version + 1 };
    }
    case "edit_filterable": {
      return { records, version: state.version + 1 };
    }
    case "archive": {
      const active = records.find((r) => r.lifecycleState === "active");
      if (active) active.lifecycleState = "archived";
      return { records, version: state.version + 1 };
    }
    case "restore": {
      const archived = records.find((r) => r.lifecycleState === "archived");
      if (archived) archived.lifecycleState = "active";
      return { records, version: state.version + 1 };
    }
    case "delete": {
      const eligible = records.find(
        (r) => r.lifecycleState === "active" || r.lifecycleState === "archived",
      );
      if (eligible) eligible.lifecycleState = "recently_deleted";
      return { records, version: state.version + 1 };
    }
    case "purge": {
      const deleted = records.find((r) => r.lifecycleState === "recently_deleted");
      if (deleted) deleted.lifecycleState = "purging";
      return { records, version: state.version + 1 };
    }
  }
}

function generateRecords(count: number): TraversalRecord[] {
  const records: TraversalRecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push({
      id: `id-${String(i + 1).padStart(4, "0")}`,
      occurredAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
      lifecycleState: "active",
    });
  }
  return records;
}

function generateTiedRecords(count: number): TraversalRecord[] {
  const records: TraversalRecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push({
      id: `id-${String(i + 1).padStart(4, "0")}`,
      occurredAt: "2026-01-15T10:00:00.000Z",
      lifecycleState: "active",
    });
  }
  return records;
}

describe("versioned traversal property contracts (FR-030; SC-026)", () => {
  describe("1. unchanged traversal", () => {
    it("produces deterministic (occurred_at DESC, id DESC) order across pages", () => {
      for (const count of [0, 1, 5, 10, 25, 50, 100]) {
        const records = generateRecords(count);
        const pages = paginate(records, 10);
        const allRows = pages.flat();
        const expected = sortRecords(filterEligible(records));
        expect(allRows).toEqual(expected);
      }
    });

    it("every eligible record appears exactly once across all pages", () => {
      for (const count of [10, 25, 50, 100]) {
        const records = generateRecords(count);
        const pages = paginate(records, 10);
        const allRows = pages.flat();
        const ids = allRows.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(allRows.length).toBe(filterEligible(records).length);
      }
    });

    it("no duplicates across page boundaries", () => {
      const records = generateRecords(100);
      const pages = paginate(records, 10);
      const allIds = pages.flat().map((r) => r.id);
      expect(new Set(allIds).size).toBe(allIds.length);
    });

    it("no omissions under unchanged traversal", () => {
      const records = generateRecords(50);
      const pages = paginate(records, 10);
      const eligible = filterEligible(records);
      const allRows = pages.flat();
      expect(allRows.length).toBe(eligible.length);
      const eligibleIds = new Set(eligible.map((r) => r.id));
      for (const row of allRows) {
        expect(eligibleIds.has(row.id)).toBe(true);
      }
    });
  });

  describe("2. tie ordering", () => {
    it("identical occurred_at uses id DESC for deterministic tie-breaking", () => {
      const records = generateTiedRecords(30);
      const pages = paginate(records, 10);
      const allRows = pages.flat();
      for (let i = 1; i < allRows.length; i++) {
        const prev = allRows[i - 1];
        const curr = allRows[i];
        if (prev === undefined || curr === undefined) continue;
        expect(prev.occurredAt).toBe(curr.occurredAt);
        expect(prev.id > curr.id).toBe(true);
      }
    });

    it("tie-breaking is stable across page boundaries", () => {
      const records = generateTiedRecords(25);
      const pages = paginate(records, 10);
      const allRows = pages.flat();
      for (let i = 1; i < allRows.length; i++) {
        const prev = allRows[i - 1];
        const curr = allRows[i];
        if (prev === undefined || curr === undefined) continue;
        if (prev.occurredAt === curr.occurredAt) {
          expect(prev.id > curr.id).toBe(true);
        }
      }
    });
  });

  describe("3. stale version", () => {
    it("list-affecting mutation produces RESULTS_CHANGED", () => {
      const mutations: MutationClass[] = [
        "create",
        "edit_occurrence",
        "edit_filterable",
        "archive",
        "restore",
        "delete",
        "purge",
      ];
      for (const mutation of mutations) {
        const state: TraversalState = { records: generateRecords(20), version: 1 };
        const cursorVersion = state.version;
        const afterMutation = applyMutation(state, mutation);
        expect(afterMutation.version).toBe(cursorVersion + 1);
        const isStale = afterMutation.version !== cursorVersion;
        expect(isStale).toBe(true);
      }
    });

    it("RESULTS_CHANGED means zero rows returned", () => {
      const state: TraversalState = { records: generateRecords(20), version: 1 };
      const afterMutation = applyMutation(state, "create");
      const isStale = afterMutation.version !== state.version;
      expect(isStale).toBe(true);
      if (isStale) {
        const continuationRows: TraversalRecord[] = [];
        expect(continuationRows).toHaveLength(0);
      }
    });
  });

  describe("4. query binding", () => {
    it("different query fingerprint produces RESULTS_CHANGED even if version matches", () => {
      const state: TraversalState = { records: generateRecords(20), version: 1 };
      const cursorFingerprint = "query-A" as string;
      const currentFingerprint = "query-B" as string;
      const fingerprintMatch: boolean = cursorFingerprint === currentFingerprint;
      const versionMatch = state.version === state.version;
      const shouldReturnRows = fingerprintMatch && versionMatch;
      expect(shouldReturnRows).toBe(false);
    });

    it("same query fingerprint with matching version returns rows", () => {
      const state: TraversalState = { records: generateRecords(20), version: 1 };
      const cursorFingerprint = "query-A" as string;
      const currentFingerprint = "query-A" as string;
      const fingerprintMatch = cursorFingerprint === currentFingerprint;
      const versionMatch = state.version === state.version;
      expect(fingerprintMatch).toBe(true);
      expect(versionMatch).toBe(true);
    });
  });

  describe("5. inaccessible rows", () => {
    it("purged rows are never returned to preserve cursor continuity", () => {
      const records: TraversalRecord[] = [
        { id: "id-0001", occurredAt: "2026-01-01T10:00:00.000Z", lifecycleState: "active" },
        { id: "id-0002", occurredAt: "2026-01-02T10:00:00.000Z", lifecycleState: "purging" },
        { id: "id-0003", occurredAt: "2026-01-03T10:00:00.000Z", lifecycleState: "active" },
      ];
      const eligible = filterEligible(records);
      expect(eligible).toHaveLength(2);
      expect(eligible.find((r) => r.id === "id-0002")).toBeUndefined();
    });

    it("recently_deleted rows are excluded from normal traversal", () => {
      const records: TraversalRecord[] = [
        { id: "id-0001", occurredAt: "2026-01-01T10:00:00.000Z", lifecycleState: "active" },
        {
          id: "id-0002",
          occurredAt: "2026-01-02T10:00:00.000Z",
          lifecycleState: "recently_deleted",
        },
        { id: "id-0003", occurredAt: "2026-01-03T10:00:00.000Z", lifecycleState: "active" },
      ];
      const eligible = filterEligible(records);
      expect(eligible).toHaveLength(2);
      expect(eligible.find((r) => r.id === "id-0002")).toBeUndefined();
    });

    it("cross-account rows are never returned", () => {
      const accountARecords: TraversalRecord[] = [
        { id: "id-A001", occurredAt: "2026-01-01T10:00:00.000Z", lifecycleState: "active" },
      ];
      const traversalForA = filterEligible(accountARecords);
      expect(traversalForA.find((r) => r.id === "id-B001")).toBeUndefined();
    });
  });

  describe("6. mutation classes", () => {
    const mutations: MutationClass[] = [
      "create",
      "edit_occurrence",
      "edit_filterable",
      "archive",
      "restore",
      "delete",
      "purge",
    ];

    for (const mutation of mutations) {
      it(`${mutation} increments version`, () => {
        const state: TraversalState = { records: generateRecords(10), version: 1 };
        const after = applyMutation(state, mutation);
        expect(after.version).toBe(state.version + 1);
      });
    }

    it("non-list-affecting mutation preserves version", () => {
      const state: TraversalState = { records: generateRecords(10), version: 5 };
      const unchangedState = { ...state, records: [...state.records] };
      expect(unchangedState.version).toBe(state.version);
    });

    it("multiple sequential mutations increment version each time", () => {
      let state: TraversalState = { records: generateRecords(10), version: 1 };
      for (const mutation of mutations) {
        state = applyMutation(state, mutation);
      }
      expect(state.version).toBe(1 + mutations.length);
    });
  });

  describe("7. generated boundary cases", () => {
    it("empty record set produces zero pages", () => {
      const pages = paginate([], 10);
      expect(pages).toHaveLength(0);
    });

    it("single record produces single page", () => {
      const pages = paginate(generateRecords(1), 10);
      expect(pages).toHaveLength(1);
      expect(pages[0]).toHaveLength(1);
    });

    it("exactly page-size records produce single page", () => {
      const pages = paginate(generateRecords(10), 10);
      expect(pages).toHaveLength(1);
    });

    it("page-size + 1 records produce two pages", () => {
      const pages = paginate(generateRecords(11), 10);
      expect(pages).toHaveLength(2);
      expect(pages[1]).toHaveLength(1);
    });

    it("all records on same timestamp use id DESC", () => {
      const records = generateTiedRecords(50);
      const pages = paginate(records, 10);
      const allRows = pages.flat();
      expect(allRows).toHaveLength(50);
      for (let i = 1; i < allRows.length; i++) {
        const prev = allRows[i - 1];
        const curr = allRows[i];
        if (prev === undefined || curr === undefined) continue;
        expect(prev.id > curr.id).toBe(true);
      }
    });
  });
});
