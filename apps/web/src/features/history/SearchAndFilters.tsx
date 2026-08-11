import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from "react";

import {
  JournalApiError,
  type CategoryView,
  type JournalApiPort,
  type MoneySpaceView,
  type SearchFilters,
  type SearchItem,
} from "../../app/journal-api.js";

export interface SearchAndFiltersProps {
  readonly api: JournalApiPort;
}

interface CriteriaState {
  categoryId: string;
  currency: string;
  direction: "" | "expense" | "income";
  from: string;
  lifecycle: "" | "active" | "archived";
  moneySpaceId: string;
  planningStatus: "" | "planned" | "unplanned" | "unspecified";
  purpose: "" | "mixed" | "personal" | "unspecified" | "work";
  query: string;
  to: string;
}

const initialCriteria: CriteriaState = {
  categoryId: "",
  currency: "",
  direction: "",
  from: "",
  lifecycle: "",
  moneySpaceId: "",
  planningStatus: "",
  purpose: "",
  query: "",
  to: "",
};

function instant(value: string): string | null {
  return value === "" ? null : new Date(value).toISOString();
}

function filters(criteria: Readonly<CriteriaState>): SearchFilters {
  return {
    categoryIds: criteria.categoryId === "" ? [] : [criteria.categoryId],
    currencies: criteria.currency === "" ? [] : [criteria.currency.toUpperCase()],
    directions: criteria.direction === "" ? [] : [criteria.direction],
    from: instant(criteria.from),
    lifecycles: criteria.lifecycle === "" ? [] : [criteria.lifecycle],
    moneySpaceIds: criteria.moneySpaceId === "" ? [] : [criteria.moneySpaceId],
    planningStatuses: criteria.planningStatus === "" ? [] : [criteria.planningStatus],
    purposes: criteria.purpose === "" ? [] : [criteria.purpose],
    to: instant(criteria.to),
  };
}

export function SearchAndFilters({ api }: SearchAndFiltersProps) {
  const [criteria, setCriteria] = useState<CriteriaState>(initialCriteria);
  const [categories, setCategories] = useState<readonly CategoryView[]>([]);
  const [spaces, setSpaces] = useState<readonly MoneySpaceView[]>([]);
  const [items, setItems] = useState<readonly SearchItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<"privacy" | "server" | "validation" | null>(null);
  const [resultsChanged, setResultsChanged] = useState(false);

  useEffect(() => {
    void Promise.all([api.listCategories(), api.listMoneySpaces()])
      .then(([nextCategories, nextSpaces]) => {
        setCategories(nextCategories);
        setSpaces(nextSpaces);
      })
      .catch(() => {
        // Search remains available without label pickers.
      });
  }, [api]);

  const runSearch = useCallback(
    async (nextCursor: string | null, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.search({
          cursor: nextCursor,
          filters: filters(criteria),
          limit: 2,
          query: criteria.query.trim() === "" ? null : criteria.query,
        });
        setItems((current) => (append ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setSearched(true);
        setResultsChanged(false);
      } catch (searchError) {
        if (searchError instanceof JournalApiError && searchError.code === "RESULTS_CHANGED") {
          setResultsChanged(true);
          setItems([]);
          setCursor(null);
          try {
            const restarted = await api.search({
              cursor: null,
              filters: filters(criteria),
              limit: 2,
              query: criteria.query.trim() === "" ? null : criteria.query,
            });
            setItems(restarted.items);
            setCursor(restarted.nextCursor);
            setSearched(true);
          } catch {
            setError("server");
          }
        } else if (
          searchError instanceof JournalApiError &&
          searchError.code === "PRIVACY_BOUNDARY_BLOCKED"
        ) {
          setError("privacy");
        } else if (
          searchError instanceof JournalApiError &&
          searchError.code === "VALIDATION_ERROR"
        ) {
          setError("validation");
        } else {
          setError("server");
        }
      } finally {
        setLoading(false);
      }
    },
    [api, criteria],
  );

  const activeCriteria = useMemo(
    () => Object.entries(criteria).filter(([, value]) => value !== ""),
    [criteria],
  );

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runSearch(null, false);
  };

  const removeCriterion = (key: string) => {
    setCriteria((current) => ({ ...current, [key]: "" }));
  };

  const reset = () => {
    setCriteria(initialCriteria);
    setItems([]);
    setCursor(null);
    setSearched(false);
    setError(null);
    setResultsChanged(false);
  };

  return (
    <section aria-labelledby="search-title" data-testid="private-search">
      <h2 id="search-title">Find journal activity</h2>
      <p>Search stays private and combines every selected criterion.</p>
      <p>
        Do not enter bank account or card numbers, passwords, access tokens, full bank statements,
        or government ID information.
      </p>
      <form data-testid="search-form" onSubmit={submit}>
        <label htmlFor="search-query">Search notes or labels</label>
        <input
          id="search-query"
          maxLength={200}
          value={criteria.query}
          onChange={(event) =>
            setCriteria((current) => ({ ...current, query: event.target.value }))
          }
        />
        <label htmlFor="search-from">From</label>
        <input
          id="search-from"
          type="datetime-local"
          value={criteria.from}
          onChange={(event) => setCriteria((current) => ({ ...current, from: event.target.value }))}
        />
        <label htmlFor="search-to">To</label>
        <input
          id="search-to"
          type="datetime-local"
          value={criteria.to}
          onChange={(event) => setCriteria((current) => ({ ...current, to: event.target.value }))}
        />
        <label htmlFor="search-direction">Direction</label>
        <select
          id="search-direction"
          value={criteria.direction}
          onChange={(event) =>
            setCriteria((current) => ({
              ...current,
              direction: event.target.value as CriteriaState["direction"],
            }))
          }
        >
          <option value="">Any</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <label htmlFor="search-category">Category</label>
        <select
          id="search-category"
          value={criteria.categoryId}
          onChange={(event) =>
            setCriteria((current) => ({ ...current, categoryId: event.target.value }))
          }
        >
          <option value="">Any</option>
          {categories.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <label htmlFor="search-space">Money Space</label>
        <select
          id="search-space"
          value={criteria.moneySpaceId}
          onChange={(event) =>
            setCriteria((current) => ({ ...current, moneySpaceId: event.target.value }))
          }
        >
          <option value="">Any</option>
          {spaces.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <label htmlFor="search-purpose">Purpose</label>
        <select
          id="search-purpose"
          value={criteria.purpose}
          onChange={(event) =>
            setCriteria((current) => ({
              ...current,
              purpose: event.target.value as CriteriaState["purpose"],
            }))
          }
        >
          <option value="">Any</option>
          <option value="personal">Personal</option>
          <option value="work">Work</option>
          <option value="mixed">Mixed</option>
          <option value="unspecified">Unspecified</option>
        </select>
        <label htmlFor="search-planning">Plan status</label>
        <select
          id="search-planning"
          value={criteria.planningStatus}
          onChange={(event) =>
            setCriteria((current) => ({
              ...current,
              planningStatus: event.target.value as CriteriaState["planningStatus"],
            }))
          }
        >
          <option value="">Any</option>
          <option value="planned">Planned</option>
          <option value="unplanned">Unplanned</option>
          <option value="unspecified">Unspecified</option>
        </select>
        <label htmlFor="search-currency">Currency</label>
        <input
          id="search-currency"
          maxLength={3}
          value={criteria.currency}
          onChange={(event) =>
            setCriteria((current) => ({ ...current, currency: event.target.value }))
          }
        />
        <label htmlFor="search-lifecycle">Lifecycle</label>
        <select
          id="search-lifecycle"
          value={criteria.lifecycle}
          onChange={(event) =>
            setCriteria((current) => ({
              ...current,
              lifecycle: event.target.value as CriteriaState["lifecycle"],
            }))
          }
        >
          <option value="">Active and archived</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <button type="submit" disabled={loading}>
          Search
        </button>
        <button type="button" onClick={reset}>
          Reset filters
        </button>
      </form>

      <div aria-label="Active criteria" data-testid="active-criteria">
        {activeCriteria.map(([key, value]) => (
          <button key={key} type="button" onClick={() => removeCriterion(key)}>
            {key}: {value} ×
          </button>
        ))}
      </div>
      {loading && <p data-testid="search-loading">Searching…</p>}
      {resultsChanged && (
        <p data-testid="search-results-changed">
          Results changed. Refreshed from first page with your criteria preserved.
        </p>
      )}
      {error === "privacy" && (
        <p data-testid="search-privacy-error">
          Remove sensitive information or abandon this search.
        </p>
      )}
      {error === "validation" && (
        <p data-testid="search-validation-error">Review the search criteria.</p>
      )}
      {error === "server" && (
        <p data-testid="search-server-error">
          Search is temporarily unavailable. Your criteria are preserved.
        </p>
      )}
      {searched && !loading && error === null && items.length === 0 && (
        <p data-testid="search-no-match">No matching activity. Remove criteria or reset filters.</p>
      )}
      {items.length > 0 && (
        <ul data-testid="search-results">
          {items.map((item) => (
            <li key={item.id} data-testid={`search-result-${item.id}`}>
              <span>{item.direction}</span>{" "}
              <span>
                {item.amountMinor} {item.currencyCode}
              </span>{" "}
              <span>{item.note ?? "No note"}</span> <span>{item.lifecycleState}</span>
            </li>
          ))}
        </ul>
      )}
      {cursor !== null && (
        <button
          data-testid="search-next-page"
          type="button"
          disabled={loading}
          onClick={() => void runSearch(cursor, true)}
        >
          Load more
        </button>
      )}
    </section>
  );
}
