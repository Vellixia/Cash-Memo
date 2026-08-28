import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session: {
    access: string | undefined;
    isPending: boolean;
    isError: boolean;
  } = {
    access: "FULL",
    isPending: false,
    isError: false,
  };

  return {
    mutate: vi.fn().mockResolvedValue({ data: {} }),
    routes: [] as string[],
    session,
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/transactions/new",
  useRouter: () => ({ replace: (path: string) => mocks.routes.push(path) }),
}));

vi.mock("../features/auth/use-session", () => ({
  useSession: () => ({
    data: mocks.session.access ? { data: { access: mocks.session.access } } : undefined,
    isPending: mocks.session.isPending,
    isError: mocks.session.isError,
    error: null,
  }),
}));

vi.mock("../generated/api", () => {
  const query = (data: unknown) => ({
    data: { data },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  const mutation = () => ({ mutateAsync: mocks.mutate, isPending: false });
  return {
    getGetBudgetSummaryQueryKey: () => ["budget-summary"],
    getGetMonthlySummaryQueryKey: () => ["monthly-summary"],
    getGetWalletQueryKey: () => ["wallet"],
    getListBudgetsQueryKey: () => ["budgets"],
    getListCategoriesQueryKey: () => ["categories"],
    getListRecurringTransactionsQueryKey: () => ["recurring"],
    getListTransactionsQueryKey: () => ["transactions"],
    getListTrashedTransactionsQueryKey: () => ["trash"],
    getListWalletsQueryKey: () => ["wallets"],
    useCreateRecurringTransaction: mutation,
    useCreateTransaction: mutation,
    useGetTransactionEntryDefaults: () => query({ last_used_wallet_id: "wallet-1" }),
    useListCategories: () =>
      query([
        {
          id: "category-1",
          name: "Food & Drink",
          kind: "expense",
          archived_at: null,
        },
      ]),
    useListCurrencies: () => query([{ code: "USD", display_name: "US Dollar", exponent: 2 }]),
    useListWallets: () =>
      query([
        {
          id: "wallet-1",
          name: "Cash",
          currency: "USD",
          archived_at: null,
        },
      ]),
    useRequestAccountDeletion: mutation,
    useUpdateRecurringTransaction: mutation,
    useUpdateTransaction: mutation,
  };
});

import AppLayout from "../app/(auth)/app/layout";
import { AppShell } from "../components/app-shell/app-shell";
import { BudgetProgress } from "../features/budgets/budget-progress";
import { RecurringForm } from "../features/recurring/recurring-form";
import { AccountDeletion } from "../features/settings/account-deletion";
import { TransactionForm } from "../features/transactions/form";

const webRoot = resolve(import.meta.dirname, "..");
const globalsCss = readFileSync(resolve(webRoot, "app/globals.css"), "utf8");

/** Every declaration block whose selector list mentions `selector`, in source order. */
function cssBlocks(selector: string): string[] {
  const blocks: string[] = [];
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const opener = new RegExp(String.raw`(^|[,{}\s])${escaped}\s*(,[^{}]*)?\{`, "g");
  let match = opener.exec(globalsCss);
  while (match) {
    const start = globalsCss.indexOf("{", match.index + match[1].length) + 1;
    const end = globalsCss.indexOf("}", start);
    blocks.push(globalsCss.slice(start, end));
    match = opener.exec(globalsCss);
  }
  return blocks;
}

function moduleFile(candidate: string): string | undefined {
  for (const suffix of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const attempt = `${candidate}${suffix}`;
    try {
      const source = readFileSync(attempt, "utf8");
      if (source.length >= 0 && !attempt.endsWith("/")) return attempt;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Every first-party module reachable from `entry` through static imports. */
function reachableModules(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const source = readFileSync(current, "utf8");
    for (const match of source.matchAll(/from\s+"(\.[^"]*)"/g)) {
      const resolved = moduleFile(resolve(dirname(current), match[1]));
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen].map((file) => relative(webRoot, file));
}

function renderWithQuery(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function hrefsWithin(container: HTMLElement | Document): string[] {
  return [...container.querySelectorAll("a[href^='/app']")].map(
    (link) => link.getAttribute("href") ?? "",
  );
}

describe("app shell navigation", () => {
  beforeEach(() => {
    mocks.routes.length = 0;
    mocks.session.access = "FULL";
    mocks.session.isPending = false;
    mocks.session.isError = false;
  });

  afterEach(cleanup);

  it("names every desktop destination once with a route-driven Add action", () => {
    renderWithQuery(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const primary = screen.getByRole("navigation", { name: "Primary navigation" });
    const labels = [...primary.querySelectorAll("a")].map((link) => link.textContent.trim());
    expect(labels).toEqual([
      "Overview",
      "Transactions",
      "Wallets",
      "Categories",
      "Budgets",
      "Recurring",
      "Settings",
    ]);
    expect(hrefsWithin(primary)).toEqual([
      "/app",
      "/app/transactions",
      "/app/wallets",
      "/app/categories",
      "/app/budgets",
      "/app/recurring",
      "/app/settings",
    ]);

    const desktopAdd = screen
      .getAllByRole("link", { name: "Add" })
      .map((link) => link.getAttribute("href"));
    expect(desktopAdd.length).toBeGreaterThan(0);
    expect(desktopAdd.every((href) => href === "/app/transactions/new")).toBe(true);
    expect(screen.queryByRole("link", { name: "History" })).toBeNull();
  });

  it("shows the five mobile destinations with More as a Sheet trigger", () => {
    renderWithQuery(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const mobile = screen.getByRole("navigation", { name: "Mobile navigation" });
    const items = [...mobile.querySelectorAll("a, button")].map((node) => node.textContent.trim());
    expect(items).toEqual(["Overview", "Transactions", "Add", "Budgets", "More"]);
    expect(hrefsWithin(mobile)).toEqual([
      "/app",
      "/app/transactions",
      "/app/transactions/new",
      "/app/budgets",
    ]);
    const more = mobile.querySelector("button");
    expect(more?.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("opens the More Sheet, moves focus into it, and restores focus on close", async () => {
    renderWithQuery(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);

    const sheet = await screen.findByRole("dialog");
    expect(sheet.getAttribute("aria-labelledby")).toBeTruthy();
    await waitFor(() => {
      expect(sheet.contains(document.activeElement)).toBe(true);
    });

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.activeElement).toBe(more);
  });

  it("reaches the same information architecture on mobile as on desktop", async () => {
    renderWithQuery(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const desktop = new Set([
      ...hrefsWithin(screen.getByRole("navigation", { name: "Primary navigation" })),
      "/app/transactions/new",
    ]);
    const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const sheet = await screen.findByRole("dialog");
    const mobile = new Set([...hrefsWithin(mobileNav), ...hrefsWithin(sheet)]);

    expect([...mobile].sort()).toEqual([...desktop].sort());
  });

  it("reserves safe-area content inset and never scrolls the mobile nav sideways", () => {
    expect(globalsCss).toContain("--bottom-nav-height:");

    const bottomNav = cssBlocks(".bottom-nav");
    expect(bottomNav.length).toBeGreaterThan(0);
    for (const block of bottomNav) {
      expect(block).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    }
    const navList = cssBlocks(".bottom-nav ul");
    expect(navList.some((block) => /repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(block))).toBe(true);

    const main = cssBlocks(".app-main");
    expect(
      main.some(
        (block) =>
          /padding-bottom:\s*calc\([^;]*var\(--bottom-nav-height\)/.test(block) &&
          /padding-bottom:\s*calc\([^;]*var\(--safe-area-bottom\)/.test(block),
      ),
    ).toBe(true);
  });

  it("keeps the financial shell out of the restricted-mode module graph", () => {
    const restricted = reachableModules(resolve(webRoot, "app/(auth)/deletion/page.tsx"));
    expect(restricted).toContain("components/auth-gate.tsx");
    expect(restricted.filter((file) => file.startsWith("components/app-shell/"))).toEqual([]);
  });

  it("never mounts the shell for a deletion-only session", async () => {
    mocks.session.access = "DELETION_ONLY";
    renderWithQuery(
      <AppLayout>
        <p>financial content</p>
      </AppLayout>,
    );

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("financial content")).toBeNull();
    await waitFor(() => {
      expect(mocks.routes).toEqual(["/deletion"]);
    });
  });
});

describe("accessibility contract", () => {
  beforeEach(() => {
    mocks.mutate.mockClear();
    mocks.routes.length = 0;
    mocks.session.access = "FULL";
  });

  afterEach(cleanup);

  it("keeps real app landmarks and route-driven transaction form semantics", async () => {
    renderWithQuery(
      <AppShell>
        <TransactionForm />
      </AppShell>,
    );
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy();
    expect(document.querySelector('nav[aria-label="Mobile navigation"]')).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "Transactions" })
        .every((link) => link.getAttribute("href") === "/app/transactions"),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: "Add" })
        .every((link) => link.getAttribute("href") === "/app/transactions/new"),
    ).toBe(true);
    expect(screen.queryByRole("link", { name: "Capture" })).toBeNull();
    expect(screen.getByRole("heading", { name: "New transaction", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    const amount = screen.getByLabelText("Amount");
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>("Wallet").value).toBe("wallet-1");
    });
    const transactionForm = amount.closest("form");
    expect(transactionForm).toBeTruthy();
    if (!transactionForm) throw new Error("transaction amount must belong to its form");
    fireEvent.submit(transactionForm);
    await waitFor(() => {
      expect(amount.getAttribute("aria-invalid")).toBe("true");
    });
    const errorId = amount.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    if (!errorId) throw new Error("amount error must be linked");
    expect(document.getElementById(errorId)?.getAttribute("role")).toBe("alert");
  });

  it("links recurring and account-deletion errors from real component forms", async () => {
    const recurring = renderWithQuery(<RecurringForm />);
    expect(screen.getByRole("heading", { name: "New recurring rule", level: 2 })).toBeTruthy();
    const recurringForm = screen
      .getByRole("button", { name: "Create recurring rule" })
      .closest("form");
    expect(recurringForm).toBeTruthy();
    if (!recurringForm) throw new Error("recurring submit must belong to its form");
    fireEvent.submit(recurringForm);
    await waitFor(() => {
      expect(screen.getByLabelText("Amount").getAttribute("aria-invalid")).toBe("true");
    });
    expect(screen.getByLabelText("Wallet").getAttribute("aria-describedby")).toBe(
      "recurring-wallet-error",
    );
    recurring.unmount();

    renderWithQuery(<AccountDeletion />);
    expect(screen.getByRole("heading", { name: "Delete account", level: 2 })).toBeTruthy();
    const deletionForm = screen
      .getByRole("button", { name: "Schedule account deletion" })
      .closest("form");
    expect(deletionForm).toBeTruthy();
    if (!deletionForm) throw new Error("deletion submit must belong to its form");
    fireEvent.submit(deletionForm);
    const password = screen.getByLabelText("Current password");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-describedby")).toBe("deletion-password-error");
    expect(document.getElementById("deletion-password-error")?.getAttribute("role")).toBe("alert");
  });

  it("communicates budget meaning without relying on red or green color", () => {
    render(
      <BudgetProgress
        categoryName="Food & Drink"
        budget={{
          id: "budget-1",
          category_id: "category-1",
          currency: "USD",
          budgeted: "100.00",
          spent: "120.00",
          remaining: "-20.00",
          progress: "120",
        }}
      />,
    );
    expect(screen.getByText("Over budget")).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "Food & Drink budget progress" })
        .getAttribute("aria-valuetext"),
    ).toBe("120% used — over budget");
  });
});
