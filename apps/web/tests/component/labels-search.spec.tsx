import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  JournalApiError,
  type CategoryView,
  type JournalApiPort,
  type MoneySpaceView,
  type SearchPage,
} from "../../src/app/journal-api.js";
import { SearchAndFilters } from "../../src/features/history/SearchAndFilters.js";
import { LabelManager } from "../../src/features/labels/LabelManager.js";

const category: CategoryView = {
  id: "10000000-0000-4000-8000-000000000001",
  kind: "expense",
  name: "Food",
  origin: "starter",
  revision: "1",
  status: "active",
};
const space: MoneySpaceView = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Personal",
  origin: "starter",
  revision: "1",
  status: "active",
};
const emptyPage: SearchPage = { items: [], nextCursor: null, resultSetVersion: 1 };

function api(overrides: Partial<JournalApiPort> = {}): JournalApiPort {
  return {
    createCategory: vi.fn(async (input: Parameters<JournalApiPort["createCategory"]>[0]) => ({
      ...category,
      id: crypto.randomUUID(),
      name: input.name,
      origin: "custom" as const,
    })),
    createMoneySpace: vi.fn(async (input: Parameters<JournalApiPort["createMoneySpace"]>[0]) => ({
      ...space,
      id: crypto.randomUUID(),
      name: input.name,
      origin: "custom" as const,
    })),
    listCategories: vi.fn(async () => [category]),
    listMoneySpaces: vi.fn(async () => [space]),
    search: vi.fn(async () => emptyPage),
    updateCategory: vi.fn(
      async (
        _id: Parameters<JournalApiPort["updateCategory"]>[0],
        input: Parameters<JournalApiPort["updateCategory"]>[1],
      ) => ({
        ...category,
        name: input.name ?? category.name,
        revision: "2",
        status: input.status ?? category.status,
      }),
    ),
    updateMoneySpace: vi.fn(
      async (
        _id: Parameters<JournalApiPort["updateMoneySpace"]>[0],
        input: Parameters<JournalApiPort["updateMoneySpace"]>[1],
      ) => ({
        ...space,
        name: input.name ?? space.name,
        revision: "2",
        status: input.status ?? space.status,
      }),
    ),
    ...overrides,
  };
}

describe("Phase 7 label and private search UI", () => {
  it("shows starter/custom label management with contextual Money Space copy", async () => {
    render(<LabelManager api={api()} />);
    await screen.findByText("Food");
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByText(/contextual labels such as Personal/u)).toBeInTheDocument();
    expect(screen.queryByLabelText(/balance/iu)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/account number/iu)).not.toBeInTheDocument();
  });

  it("creates Categories and Money Spaces", async () => {
    const journal = api();
    render(<LabelManager api={journal} />);
    await screen.findByText("Food");
    fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Travel" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Category" }));
    await screen.findByText("Travel");
    fireEvent.change(screen.getByLabelText("Context name"), { target: { value: "Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Money Space" }));
    await screen.findByText("Project");
  });

  it("preserves failed rename input and shows conflict", async () => {
    const journal = api({
      updateCategory: vi.fn(async () => {
        throw new JournalApiError("REVISION_CONFLICT", false);
      }),
    });
    render(<LabelManager api={journal} />);
    const edit = await screen.findByLabelText("Rename Food");
    fireEvent.change(edit, { target: { value: "Edited locally" } });
    const save = screen.getAllByRole("button", { name: "Save name" }).at(0);
    if (save === undefined) throw new Error("Missing save control");
    fireEvent.click(save);
    await screen.findByTestId("labels-conflict");
    expect(edit).toHaveValue("Edited locally");
  });

  it("shows/removes criteria and renders no-match state", async () => {
    render(<SearchAndFilters api={api()} />);
    const query = screen.getByLabelText("Search notes or labels");
    fireEvent.change(query, { target: { value: "nothing" } });
    expect(screen.getByTestId("active-criteria")).toHaveTextContent("query: nothing");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByTestId("search-no-match");
    fireEvent.click(screen.getByRole("button", { name: /query: nothing/u }));
    expect(query).toHaveValue("");
  });

  it("keeps criteria, drops stale pages, and restarts after RESULTS_CHANGED", async () => {
    const first: SearchPage = {
      items: [
        {
          amountMinor: "100",
          categoryId: category.id,
          currencyCode: "USD",
          direction: "expense",
          id: "30000000-0000-4000-8000-000000000001",
          lifecycleState: "active",
          moneySpaceId: space.id,
          note: "first",
          occurredAt: "2026-01-02T00:00:00.000Z",
          planningStatus: "planned",
          purpose: "personal",
          revision: "1",
        },
      ],
      nextCursor: "opaque-cursor",
      resultSetVersion: 1,
    };
    const firstItem = first.items.at(0);
    if (firstItem === undefined) throw new Error("Missing first fixture item");
    const restarted: SearchPage = {
      ...first,
      items: [{ ...firstItem, id: "30000000-0000-4000-8000-000000000002", note: "restarted" }],
      resultSetVersion: 2,
    };
    const search = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new JournalApiError("RESULTS_CHANGED", false))
      .mockResolvedValueOnce(restarted);
    render(<SearchAndFilters api={api({ search })} />);
    fireEvent.change(screen.getByLabelText("Search notes or labels"), {
      target: { value: "kept" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("first");
    fireEvent.click(screen.getByTestId("search-next-page"));
    await screen.findByTestId("search-results-changed");
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("restarted")).toBeInTheDocument();
    expect(screen.getByLabelText("Search notes or labels")).toHaveValue("kept");
  });

  it("uses POST body without private URL criteria", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(emptyPage), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const { createJournalApi } = await import("../../src/app/journal-api.js");
    await createJournalApi().search({
      cursor: null,
      filters: {
        categoryIds: [],
        currencies: [],
        directions: [],
        from: null,
        lifecycles: [],
        moneySpaceIds: [],
        planningStatuses: [],
        purposes: [],
        to: null,
      },
      limit: 2,
      query: "private search value",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/memos/search",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("private search value");
    fetchMock.mockRestore();
  });
});
