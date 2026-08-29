import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Budget {
  id: string;
  category_id: string;
  currency: string;
  amount: string;
  month: string;
}
interface Progress {
  id: string;
  category_id: string;
  currency: string;
  budgeted: string;
  spent: string;
  remaining: string;
  progress: string;
}
interface CategoryOption {
  id: string;
  name: string;
  kind: string;
  archived_at: string | null;
}

const api = vi.hoisted(() => ({
  listState: "success",
  summaryState: "success",
  categoryState: "success",
  currencyState: "success",
  budgets: [
    { id: "budget", category_id: "food", currency: "USD", amount: "300.00", month: "2026-08" },
  ] as Budget[],
  summary: [
    {
      id: "budget",
      category_id: "food",
      currency: "USD",
      budgeted: "300.00",
      spent: "375.00",
      remaining: "-75.00",
      progress: "125",
    },
  ] as Progress[],
  currencies: [
    { code: "USD", display_name: "US Dollar", exponent: 2 },
    { code: "JPY", display_name: "Japanese Yen", exponent: 0 },
  ],
  categories: [{ id: "food", name: "Food", kind: "expense", archived_at: null }] as CategoryOption[],
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  retryCategories: vi.fn(),
  retryCurrencies: vi.fn(),
}));

function budgetKey(params?: unknown) {
  return params ? ["/api/v1/budgets", params] : ["/api/v1/budgets"];
}
function summaryKey(params?: unknown) {
  return params ? ["/api/v1/reports/budget-summary", params] : ["/api/v1/reports/budget-summary"];
}
function monthlyKey(params?: unknown) {
  return params ? ["/api/v1/reports/monthly-summary", params] : ["/api/v1/reports/monthly-summary"];
}

async function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const item = await screen.findByRole("option", { name: option });
  fireEvent.pointerDown(item);
  fireEvent.pointerUp(item);
  fireEvent.click(item);
}

vi.mock("../generated/api", () => ({
  useListBudgets: (params?: unknown) =>
    useQuery({
      queryKey: budgetKey(params),
      queryFn: async () => {
        if (api.listState === "loading") return await new Promise<never>(() => undefined);
        if (api.listState === "error") throw new Error("budgets unavailable");
        return { data: api.budgets };
      },
      initialData: api.listState === "success" ? { data: api.budgets } : undefined,
      retry: false,
    }),
  useGetBudgetSummary: (params?: unknown) =>
    useQuery({
      queryKey: summaryKey(params),
      queryFn: async () => {
        if (api.summaryState === "loading") return await new Promise<never>(() => undefined);
        if (api.summaryState === "error") throw new Error("summary unavailable");
        return { data: { month: "2026-08", budgets: api.summary } };
      },
      initialData:
        api.summaryState === "success"
          ? { data: { month: "2026-08", budgets: api.summary } }
          : undefined,
      retry: false,
    }),
  useListCategories: () => ({
      data:
      api.categoryState === "success"
        ? { data: api.categories }
        : undefined,
    isPending: api.categoryState === "loading",
    isError: api.categoryState === "error",
    refetch: api.retryCategories,
  }),
  useListCurrencies: () => ({
    data: api.currencyState === "success" ? { data: api.currencies } : undefined,
    isPending: api.currencyState === "loading",
    isError: api.currencyState === "error",
    refetch: api.retryCurrencies,
  }),
  useCreateBudget: () => ({ mutateAsync: api.create, isPending: false }),
  useUpdateBudget: () => ({ mutateAsync: api.update, isPending: false }),
  useDeleteBudget: () => ({ mutateAsync: api.remove, isPending: false }),
  getListBudgetsQueryKey: budgetKey,
  getGetBudgetSummaryQueryKey: summaryKey,
  getGetMonthlySummaryQueryKey: monthlyKey,
}));

function view(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const invalidations = vi.spyOn(client, "invalidateQueries");
  return {
    client,
    invalidations,
    ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>),
  };
}

describe("budgets", () => {
  beforeEach(() => {
    cleanup();
    api.listState = "success";
    api.summaryState = "success";
    api.categoryState = "success";
    api.currencyState = "success";
    api.budgets = [
      { id: "budget", category_id: "food", currency: "USD", amount: "300.00", month: "2026-08" },
    ];
    api.summary = [
      {
        id: "budget",
        category_id: "food",
        currency: "USD",
        budgeted: "300.00",
        spent: "375.00",
        remaining: "-75.00",
        progress: "125",
      },
    ];
  api.currencies = [
      { code: "USD", display_name: "US Dollar", exponent: 2 },
      { code: "JPY", display_name: "Japanese Yen", exponent: 0 },
  ];
    api.categories = [{ id: "food", name: "Food", kind: "expense", archived_at: null }];
    api.create.mockReset().mockResolvedValue({ data: {} });
    api.update
      .mockReset()
      .mockImplementation(({ data }: { data: { amount?: string; month?: string } }) => {
        const amount = data.amount ?? "300.00";
        const month = data.month ?? "2026-08";
        api.budgets = [{ ...api.budgets[0], amount, month }];
        api.summary = [
          { ...api.summary[0], budgeted: amount, remaining: "75.00", progress: "83.33" },
        ];
        return { data: api.budgets[0] };
      });
    api.remove.mockReset().mockResolvedValue({ data: {} });
    api.retryCategories.mockClear();
    api.retryCurrencies.mockClear();
  });

  it("labels server-reported overspending without color-only meaning", async () => {
    const { BudgetList } = await import("../features/budgets/budget-list");
    view(<BudgetList initialMonth="2026-08" />);
    const card = screen.getByRole("heading", { name: "Food" }).parentElement;
    expect(card?.textContent).toContain("125% used");
    expect(card?.textContent).toContain("Over budget");
    expect(screen.getByText("USD -75.00")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe(
      "125% used — over budget",
    );
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("does not call exact negative zero or malformed remaining over budget", async () => {
    const { BudgetProgress } = await import("../features/budgets/budget-progress");
    const { rerender } = view(
      <BudgetProgress
        budget={{ ...api.summary[0], remaining: "-0.00", progress: "bad" }}
        categoryName="Food"
      />,
    );
    expect(screen.getByText("Within budget")).toBeTruthy();
    rerender(
      <BudgetProgress
        budget={{ ...api.summary[0], remaining: "-oops", progress: "135.42" }}
        categoryName="Food"
      />,
    );
    expect(screen.getByText("Within budget")).toBeTruthy();
  });

  it("refetches active parameterless reads and renders authoritative returned progress after update", async () => {
    const { BudgetList } = await import("../features/budgets/budget-list");
    const rendered = view(<BudgetList />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Budget amount"), { target: { value: "450.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("USD 450.00")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("83.33% used");
    expect(rendered.invalidations).toHaveBeenCalledWith({
      queryKey: ["/api/v1/budgets"],
      exact: true,
    });
    expect(rendered.invalidations).toHaveBeenCalledWith({
      queryKey: ["/api/v1/reports/budget-summary"],
      exact: true,
    });
    expect(rendered.invalidations).toHaveBeenCalledWith({
      queryKey: ["/api/v1/reports/monthly-summary"],
      exact: true,
    });
  });

  it("omits unchanged archived category on edit and sends active replacement", async () => {
    api.categories = [
      { id: "food", name: "Food", kind: "expense", archived_at: null },
      { id: "old-food", name: "Old Food", kind: "expense", archived_at: "2026-08-01T00:00:00Z" },
    ];
    const { BudgetForm } = await import("../features/budgets/budget-form");
    const archived = { ...api.budgets[0], category_id: "old-food" };
    const rendered = view(<BudgetForm budget={archived} />);
    expect(screen.getByText(/Old Food \(archived historical category\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Budget amount"), { target: { value: "350.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const firstUpdate = api.update.mock.calls[0]?.[0] as { data?: Record<string, unknown> };
    expect(firstUpdate.data).not.toHaveProperty("category_id");
    rendered.unmount();

    view(<BudgetForm budget={archived} />);
    await choose("Category", "Food");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    const secondUpdate = api.update.mock.calls[1]?.[0] as { data?: { category_id?: string } };
    expect(secondUpdate.data?.category_id).toBe("food");
  });

  it("invalidates parameterless plus source and destination month keys when update moves month", async () => {
    const { BudgetForm } = await import("../features/budgets/budget-form");
    const rendered = view(<BudgetForm budget={api.budgets[0]} />);
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(api.update).toHaveBeenCalledTimes(1);
    });
    for (const month of ["2026-08", "2026-09"]) {
      expect(rendered.invalidations).toHaveBeenCalledWith({
        queryKey: ["/api/v1/budgets", { month }],
        exact: true,
      });
      expect(rendered.invalidations).toHaveBeenCalledWith({
        queryKey: ["/api/v1/reports/budget-summary", { month }],
        exact: true,
      });
      expect(rendered.invalidations).toHaveBeenCalledWith({
        queryKey: ["/api/v1/reports/monthly-summary", { month }],
        exact: true,
      });
    }
  });

  it("refetches authoritative active state after create and delete", async () => {
    const { BudgetList } = await import("../features/budgets/budget-list");
    api.create.mockImplementation(({ data }: { data: Omit<Budget, "id"> }) => {
      api.budgets = [{ ...data, id: "budget" }];
      api.summary = [
        {
          id: "budget",
          category_id: data.category_id,
          currency: data.currency,
          budgeted: data.amount,
          spent: "0.00",
          remaining: data.amount,
          progress: "0",
        },
      ];
      return Promise.resolve({ data: api.budgets[0] });
    });
    const created = view(<BudgetList />);
    await choose("Category", "Food");
    await choose("Currency", /USD — US Dollar/);
    fireEvent.change(screen.getByLabelText("Budget amount"), { target: { value: "500.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create budget" }));
    expect(await screen.findAllByText("USD 500.00")).toHaveLength(2);
    expect(created.invalidations).toHaveBeenCalledWith({
      queryKey: ["/api/v1/budgets", { month: "2026-08" }],
      exact: true,
    });
    created.unmount();

    api.remove.mockImplementation(() => {
      api.budgets = [];
      api.summary = [];
      return Promise.resolve({ data: {} });
    });
    const removed = view(<BudgetList />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("heading", { name: "No budgets this month" })).toBeTruthy();
    expect(removed.invalidations).toHaveBeenCalledWith({
      queryKey: ["/api/v1/budgets"],
      exact: true,
    });
    expect(removed.invalidations).toHaveBeenCalledWith({
      queryKey: ["/api/v1/reports/monthly-summary", { month: "2026-08" }],
      exact: true,
    });
  });

  it("links amount precision error to field and blocks missing registry entries", async () => {
    const { BudgetForm } = await import("../features/budgets/budget-form");
    const valid = view(<BudgetForm initialMonth="2026-08" />);
    await choose("Category", "Food");
    await choose("Currency", /USD — US Dollar/);
    fireEvent.change(screen.getByLabelText("Budget amount"), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Create budget" }));
    const amount = screen.getByLabelText("Budget amount");
    expect(amount.getAttribute("aria-invalid")).toBe("true");
    expect(amount.getAttribute("aria-describedby")).toBe("budget-amount-error");
    valid.unmount();

    api.currencies = [];
    view(<BudgetForm budget={api.budgets[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByLabelText("Budget amount").getAttribute("aria-invalid")).toBe("true");
    expect(api.update).not.toHaveBeenCalled();
  });

  it("exposes dependency loading/error retry and list loading/error/empty states", async () => {
    const { BudgetForm } = await import("../features/budgets/budget-form");
    const { BudgetList } = await import("../features/budgets/budget-list");
    api.currencyState = "loading";
    const loadingForm = view(<BudgetForm />);
    expect(screen.getByText("Loading budget options…")).toBeTruthy();
    loadingForm.unmount();
    api.currencyState = "error";
    const errorForm = view(<BudgetForm />);
    fireEvent.click(screen.getByRole("button", { name: "Retry currency registry" }));
    expect(api.retryCurrencies).toHaveBeenCalledTimes(1);
    errorForm.unmount();

    api.currencyState = "success";
    api.listState = "loading";
    const loadingList = view(<BudgetList />);
    expect(screen.getByText("Loading budgets…")).toBeTruthy();
    loadingList.unmount();
    api.listState = "error";
    const errorList = view(<BudgetList />);
    expect(await screen.findByText("Could not load budgets.")).toBeTruthy();
    errorList.unmount();
    api.listState = "success";
    api.budgets = [];
    api.summary = [];
    view(<BudgetList />);
    expect(screen.getByText("No budgets this month")).toBeTruthy();
  });

  it("keeps request failures form-level and does not claim success", async () => {
    api.create.mockRejectedValueOnce(new Error("save unavailable"));
    const { BudgetForm } = await import("../features/budgets/budget-form");
    view(<BudgetForm initialMonth="2026-08" />);
    await choose("Category", "Food");
    await choose("Currency", /USD — US Dollar/);
    fireEvent.change(screen.getByLabelText("Budget amount"), { target: { value: "12.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create budget" }));
    expect((await screen.findByRole("alert")).textContent).toContain("save unavailable");
    expect(screen.queryByText(/Budget saved/)).toBeNull();
  });
});
