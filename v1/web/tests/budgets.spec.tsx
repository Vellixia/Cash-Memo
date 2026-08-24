import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ data: { id: "new", category_id: "food", currency: "USD", amount: "450.00", month: "2026-08" } }),
  update: vi.fn().mockResolvedValue({ data: {} }),
  remove: vi.fn().mockResolvedValue({ data: {} }),
}));

vi.mock("../generated/api", () => ({
  useListBudgets: () => ({ data: { data: [{ id: "budget", category_id: "food", currency: "USD", amount: "300.00", month: "2026-08" }] }, isPending: false, isError: false, refetch: vi.fn() }),
  useGetBudgetSummary: () => ({ data: { data: { month: "2026-08", budgets: [{ id: "budget", category_id: "food", currency: "USD", budgeted: "300.00", spent: "375.00", remaining: "-75.00", progress: "125" }] } }, isPending: false, isError: false, refetch: vi.fn() }),
  useListCategories: () => ({ data: { data: [{ id: "food", name: "Food", kind: "expense", archived_at: null }] }, isPending: false, isError: false }),
  useListCurrencies: () => ({ data: { data: [{ code: "USD", display_name: "US Dollar", exponent: 2 }, { code: "JPY", display_name: "Japanese Yen", exponent: 0 }] }, isPending: false, isError: false }),
  useCreateBudget: () => ({ mutateAsync: api.create, isPending: false }),
  useUpdateBudget: () => ({ mutateAsync: api.update, isPending: false }),
  useDeleteBudget: () => ({ mutateAsync: api.remove, isPending: false }),
  getListBudgetsQueryKey: (params?: unknown) => ["/api/v1/budgets", params],
  getGetBudgetSummaryQueryKey: (params?: unknown) => ["/api/v1/reports/budget-summary", params],
  getGetMonthlySummaryQueryKey: (params?: unknown) => ["/api/v1/reports/monthly-summary", params],
}));

function view(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

describe("budgets", () => {
  beforeEach(() => api.create.mockClear());

  it("labels server-reported overspending without color-only meaning", async () => {
    const { BudgetList } = await import("../features/budgets/budget-list");
    view(<BudgetList initialMonth="2026-08" />);
    const card = screen.getByRole("heading", { name: "Food" }).parentElement;
    expect(card?.textContent).toContain("125% used");
    expect(card?.textContent).toContain("Over budget");
    expect(card?.textContent).toContain("Remaining");
    expect(screen.getByText("USD -75.00")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("125% used — over budget");
  });

  it("validates amount with generated currency exponent and creates exact decimal text", async () => {
    const { BudgetForm } = await import("../features/budgets/budget-form");
    view(<BudgetForm initialMonth="2026-08" />);
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "food" } });
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText("Budget amount"), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Create budget" }));
    expect((await screen.findByRole("alert")).textContent).toContain("up to 2 decimal places");
    fireEvent.change(screen.getByLabelText("Budget amount"), { target: { value: "450.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create budget" }));
    await waitFor(() => { expect(api.create).toHaveBeenCalledWith({ data: { category_id: "food", currency: "USD", amount: "450.00", month: "2026-08" } }); });
    expect((await screen.findByRole("status")).textContent).toContain("Budget saved");
  });

  it("loads authoritative budget values when edit starts", async () => {
    const { BudgetList } = await import("../features/budgets/budget-list");
    view(<BudgetList initialMonth="2026-08" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText<HTMLInputElement>("Budget amount").value).toBe("300.00");
    expect(screen.getByRole("heading", { name: "Edit budget" })).toBeTruthy();
  });
});
