import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { categorySchema } from "../lib/validation/category";

const listMocks = vi.hoisted(() => ({
  state: "success",
  categories: [] as { id: string; name: string; kind: string; archived_at: string | null }[],
  create: vi.fn(),
  update: vi.fn().mockResolvedValue({
    data: { id: "seeded", name: "Meals", kind: "expense", archived_at: null },
  }),
  archive: vi.fn().mockResolvedValue({
    data: {
      id: "seeded",
      name: "Meals",
      kind: "expense",
      archived_at: null,
      paused_recurring_count: 1,
    },
  }),
  restore: vi.fn().mockResolvedValue({ data: {} }),
  remove: vi.fn().mockRejectedValue({ response: { status: 409, data: { error: { message: "has references" } } } }),
}));

listMocks.categories.push(
  { id: "seeded", name: "Food & Drink", kind: "expense", archived_at: null },
  { id: "custom", name: "Travel", kind: "expense", archived_at: null },
);

vi.mock("../generated/api", () => ({
  getListCategoriesQueryKey: () => ["/api/v1/categories"],
  getListRecurringTransactionsQueryKey: () => ["/api/v1/recurring-transactions"],
  useListCategories: () => ({
    data:
      listMocks.state === "success" || listMocks.state === "empty"
        ? { data: listMocks.state === "empty" ? [] : listMocks.categories }
        : undefined,
    isPending: listMocks.state === "loading",
    isError: listMocks.state === "error",
    refetch: vi.fn(),
  }),
  useCreateCategory: () => ({ mutateAsync: listMocks.create, isPending: false }),
  useUpdateCategory: () => ({ mutateAsync: listMocks.update, isPending: false }),
  useArchiveCategory: () => ({ mutateAsync: listMocks.archive, isPending: false }),
  useRestoreCategory: () => ({ mutateAsync: listMocks.restore, isPending: false }),
  useDeleteCategory: () => ({ mutateAsync: listMocks.remove, isPending: false }),
}));

import { CategoryForm } from "../features/categories/category-form";
import { CategoryList } from "../features/categories/category-list";
import { FormField } from "../components/ui/form-field";

function renderCategoryList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CategoryList />
    </QueryClientProvider>,
  );
}

describe("category UX validation", () => {
  it("accepts both seeded and custom category kinds with exact trimmed limit", () => {
    expect(
      categorySchema.safeParse({ name: ` ${"收入".repeat(40)} `, kind: "income" }).success,
    ).toBe(true);
    expect(categorySchema.safeParse({ name: "Food", kind: "expense" }).success).toBe(true);
  });

  it("connects stable field error IDs and invalid state to controls", () => {
    render(
      <FormField label="Category name" htmlFor="category-name" error="Name is required.">
        <input id="category-name" />
      </FormField>,
    );
    const input = screen.getByLabelText("Category name");
    expect(input.getAttribute("aria-describedby")).toBe("category-name-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").id).toBe("category-name-error");
  });

  it("rejects names over 80 Unicode characters", () => {
    expect(categorySchema.safeParse({ name: "x".repeat(81), kind: "expense" }).success).toBe(false);
  });

  it("keeps over-limit category text visible so validation can explain rejection", async () => {
    render(<CategoryForm />);
    const input = screen.getByLabelText<HTMLInputElement>("Category name");
    expect(input.getAttribute("maxlength")).toBeNull();
    fireEvent.change(input, { target: { value: "x".repeat(81) } });
    expect(input.value).toBe("x".repeat(81));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("80 characters or fewer");
    });
  });

  it("renders loading, error, empty, and seeded/custom uniform list states", () => {
    listMocks.state = "loading";
    const loading = renderCategoryList();
    expect(screen.getByText("Loading categories…")).toBeTruthy();
    loading.unmount();
    listMocks.state = "error";
    const error = renderCategoryList();
    expect(screen.getByText("Could not load categories.")).toBeTruthy();
    error.unmount();
    listMocks.state = "empty";
    renderCategoryList();
    expect(screen.getByText("No active expense categories")).toBeTruthy();
    listMocks.state = "success";
    renderCategoryList();
    expect(screen.getByText("Food & Drink")).toBeTruthy();
    expect(screen.getByText("Travel")).toBeTruthy();
  });

  it("exposes matching tabpanels for keyboard and assistive technology", () => {
    listMocks.state = "success";
    listMocks.categories = [{ id: "seeded", name: "Food", kind: "expense", archived_at: null }];
    renderCategoryList();
    expect(screen.getByRole("tabpanel", { name: "Expense" })).toBeTruthy();
    const expenseTab = screen.getByRole("tab", { name: "Expense" });
    expect(expenseTab.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel", { name: "Expense" }).id);
    fireEvent.click(screen.getByRole("tab", { name: "Income" }));
    expect(screen.getByRole("tabpanel", { name: "Income" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Income" }).getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel", { name: "Income" }).id);
  });

  it("keeps embedded category forms from adding a second dialog surface", () => {
    listMocks.state = "success";
    listMocks.categories = [{ id: "seeded", name: "Food", kind: "expense", archived_at: null }];
    renderCategoryList();
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("form")?.className).not.toContain("dialog");
  });

  it("supports rename, archive/restore, and explicit hard-delete conflict feedback", async () => {
    listMocks.state = "success";
    listMocks.categories = [
      { id: "seeded", name: "Food & Drink", kind: "expense", archived_at: null },
    ];
    const initial = renderCategoryList();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Food & Drink" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    expect(screen.getByRole("heading", { name: "Rename category" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Meals" } });
    const save = screen.getByRole("button", { name: "Save name" });
    await waitFor(() => {
      expect(save).toHaveProperty("disabled", false);
    });
    fireEvent.click(save);
    await waitFor(() => {
      expect(listMocks.update).toHaveBeenCalledWith({
        categoryId: "seeded",
        data: { name: "Meals" },
      });
    });
    expect(screen.queryByRole("heading", { name: "Rename category" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Food & Drink" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive category" }));
    await waitFor(() => {
      expect(screen.getByText("Category archived. 1 recurring rule paused.")).toBeTruthy();
    });
    listMocks.categories[0] = { ...listMocks.categories[0], archived_at: "2026-08-24T00:00:00Z" };
    initial.unmount();
    const restored = renderCategoryList();
    fireEvent.click(screen.getByLabelText("Show archived"));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Food & Drink" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Restore" }));
    await waitFor(() => {
      expect(screen.getByText(/Recurring rules stay paused/)).toBeTruthy();
    });
    restored.unmount();
    renderCategoryList();
    fireEvent.click(screen.getByLabelText("Show archived"));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Food & Drink" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete forever" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => {
      expect(screen.getByText(/cannot be deleted while it has references/)).toBeTruthy();
    });
    listMocks.categories[0] = { ...listMocks.categories[0], archived_at: null };
  });

  it("hard-deletes an unreferenced category only after explicit confirmation", async () => {
    listMocks.state = "success";
    listMocks.categories = [{ id: "custom", name: "Travel", kind: "expense", archived_at: null }];
    listMocks.remove.mockResolvedValueOnce({ data: undefined });
    renderCategoryList();

    fireEvent.click(screen.getByRole("button", { name: "Actions for Travel" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete forever" }));
    expect(screen.getByText(/Delete category forever/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Category deleted.");
    });
  });

  it("keeps archive failures inside consequence dialog and maps server failures", async () => {
    listMocks.state = "success";
    listMocks.categories = [{ id: "seeded", name: "Food", kind: "expense", archived_at: null }];
    listMocks.archive.mockRejectedValueOnce(new Error("offline"));
    renderCategoryList();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Food" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive category" }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("offline"));
    listMocks.remove.mockRejectedValueOnce({ response: { status: 500, data: { error: { message: "server unavailable" } } } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Food" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete forever" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(screen.getByRole("article").textContent).toContain("Could not delete category"));
    expect(screen.getByRole("article").textContent).not.toContain("while it has references");
  });

  it("keeps archived categories behind one toggle and switches kind with Tabs", () => {
    listMocks.state = "success";
    listMocks.categories = [
      { id: "active", name: "Meals", kind: "expense", archived_at: null },
      { id: "old", name: "Old Meals", kind: "expense", archived_at: "2026-08-24T00:00:00Z" },
      { id: "salary", name: "Salary", kind: "income", archived_at: null },
    ];
    renderCategoryList();
    expect(screen.getByText("Meals")).toBeTruthy();
    expect(screen.queryByText("Old Meals")).toBeNull();
    fireEvent.click(screen.getByLabelText("Show archived"));
    expect(screen.getByText("Old Meals")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Income" }));
    expect(screen.getByText("Salary")).toBeTruthy();
    expect(screen.queryByText("Meals")).toBeNull();
  });
});
