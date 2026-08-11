import { useCallback, useEffect, useState, type SyntheticEvent } from "react";

import {
  JournalApiError,
  type CategoryView,
  type JournalApiPort,
  type LabelStatus,
  type MoneySpaceView,
} from "../../app/journal-api.js";

export interface LabelManagerProps {
  readonly api: JournalApiPort;
}

type ManagerError = "conflict" | "privacy" | "server" | null;

function errorKind(error: unknown): ManagerError {
  if (error instanceof JournalApiError) {
    if (error.code === "LABEL_CONFLICT" || error.code === "REVISION_CONFLICT") return "conflict";
    if (error.code === "PRIVACY_BOUNDARY_BLOCKED") return "privacy";
  }
  return "server";
}

export function LabelManager({ api }: LabelManagerProps) {
  const [categories, setCategories] = useState<readonly CategoryView[]>([]);
  const [spaces, setSpaces] = useState<readonly MoneySpaceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ManagerError>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryKind, setCategoryKind] = useState<"expense" | "income">("expense");
  const [spaceName, setSpaceName] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextCategories, nextSpaces] = await Promise.all([
        api.listCategories(),
        api.listMoneySpaces(),
      ]);
      setCategories(nextCategories);
      setSpaces(nextSpaces);
    } catch (loadError) {
      setError(errorKind(loadError));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const createCategory = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    void api
      .createCategory({ kind: categoryKind, name: categoryName })
      .then((created) => {
        setCategories((current) => [...current, created]);
        setCategoryName("");
      })
      .catch((createError: unknown) => setError(errorKind(createError)));
  };

  const createSpace = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    void api
      .createMoneySpace({ name: spaceName })
      .then((created) => {
        setSpaces((current) => [...current, created]);
        setSpaceName("");
      })
      .catch((createError: unknown) => setError(errorKind(createError)));
  };

  const mutateCategory = async (
    label: CategoryView,
    input: { name?: string; status?: LabelStatus },
  ) => {
    setError(null);
    try {
      const updated = await api.updateCategory(label.id, {
        expectedRevision: label.revision,
        ...input,
      });
      setCategories((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (input.name !== undefined) {
        setEdits((current) => ({ ...current, [label.id]: "" }));
      }
    } catch (mutationError) {
      setError(errorKind(mutationError));
    }
  };

  const mutateSpace = async (
    label: MoneySpaceView,
    input: { name?: string; status?: LabelStatus },
  ) => {
    setError(null);
    try {
      const updated = await api.updateMoneySpace(label.id, {
        expectedRevision: label.revision,
        ...input,
      });
      setSpaces((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (input.name !== undefined) {
        setEdits((current) => ({ ...current, [label.id]: "" }));
      }
    } catch (mutationError) {
      setError(errorKind(mutationError));
    }
  };

  return (
    <section aria-labelledby="label-manager-title" data-testid="label-manager">
      <h2 id="label-manager-title">Organize your journal</h2>
      <p>
        Categories describe activity. Money Spaces are contextual labels such as Personal, Work,
        Household, Freelance, Travel, or Project.
      </p>
      <p>
        Do not enter bank account or card numbers, passwords, access tokens, full bank statements,
        or government ID information.
      </p>

      {loading && <p data-testid="labels-loading">Loading labels…</p>}
      {error === "conflict" && (
        <p data-testid="labels-conflict">
          Label changed or active name already exists. Review your edit and try again.
        </p>
      )}
      {error === "privacy" && (
        <p data-testid="labels-privacy-error">
          Remove sensitive information or abandon this label.
        </p>
      )}
      {error === "server" && (
        <div data-testid="labels-error">
          <p>Labels are temporarily unavailable. Your edits remain here.</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {!loading && (
        <>
          <section aria-labelledby="categories-title">
            <h3 id="categories-title">Categories</h3>
            <form data-testid="create-category" onSubmit={createCategory}>
              <label htmlFor="category-kind">Direction</label>
              <select
                id="category-kind"
                value={categoryKind}
                onChange={(event) => setCategoryKind(event.target.value as "expense" | "income")}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <label htmlFor="category-name">Category name</label>
              <input
                id="category-name"
                maxLength={80}
                required
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
              />
              <button type="submit">Create Category</button>
            </form>
            {categories.length === 0 ? (
              <p data-testid="categories-empty">No Categories yet.</p>
            ) : (
              <ul data-testid="category-list">
                {categories.map((label) => (
                  <li key={label.id} data-testid={`category-${label.id}`}>
                    <span>{label.name}</span> <span>{label.kind}</span>{" "}
                    <span>{label.origin === "custom" ? "Custom" : "Starter"}</span>{" "}
                    <span>{label.status}</span>
                    <label htmlFor={`category-edit-${label.id}`}>Rename {label.name}</label>
                    <input
                      id={`category-edit-${label.id}`}
                      value={edits[label.id] ?? ""}
                      onChange={(event) =>
                        setEdits((current) => ({ ...current, [label.id]: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => void mutateCategory(label, { name: edits[label.id] ?? "" })}
                    >
                      Save name
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void mutateCategory(label, {
                          status: label.status === "active" ? "inactive" : "active",
                        })
                      }
                    >
                      {label.status === "active" ? "Deactivate" : "Restore"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="spaces-title">
            <h3 id="spaces-title">Money Spaces</h3>
            <form data-testid="create-money-space" onSubmit={createSpace}>
              <label htmlFor="space-name">Context name</label>
              <input
                id="space-name"
                maxLength={80}
                required
                value={spaceName}
                onChange={(event) => setSpaceName(event.target.value)}
              />
              <button type="submit">Create Money Space</button>
            </form>
            {spaces.length === 0 ? (
              <p data-testid="spaces-empty">No Money Spaces yet.</p>
            ) : (
              <ul data-testid="money-space-list">
                {spaces.map((label) => (
                  <li key={label.id} data-testid={`money-space-${label.id}`}>
                    <span>{label.name}</span>{" "}
                    <span>{label.origin === "custom" ? "Custom" : "Starter"}</span>{" "}
                    <span>{label.status}</span>
                    <label htmlFor={`space-edit-${label.id}`}>Rename {label.name}</label>
                    <input
                      id={`space-edit-${label.id}`}
                      value={edits[label.id] ?? ""}
                      onChange={(event) =>
                        setEdits((current) => ({ ...current, [label.id]: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => void mutateSpace(label, { name: edits[label.id] ?? "" })}
                    >
                      Save name
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void mutateSpace(label, {
                          status: label.status === "active" ? "inactive" : "active",
                        })
                      }
                    >
                      {label.status === "active" ? "Deactivate" : "Restore"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
