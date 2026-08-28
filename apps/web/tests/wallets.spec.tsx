import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { walletSchema } from "../lib/validation/wallet";

const listMocks = vi.hoisted(() => ({
  state: "success",
  wallets: [] as {
    id: string;
    name: string;
    currency: string;
    opening_balance: string;
    archived_at: string | null;
    balance: { amount: string; as_of: string; currency: string };
  }[],
  archive: vi.fn().mockResolvedValue({ data: { paused_recurring_count: 2 } }),
  restore: vi.fn().mockResolvedValue({ data: {} }),
  remove: vi.fn().mockRejectedValue(new Error("has references")),
  update: vi.fn().mockResolvedValue({ data: { id: "wallet-1", name: "Cash", currency: "USD", opening_balance: "25.00", archived_at: null, balance: { amount: "27.00", as_of: "2026-08-24T00:00:00Z", currency: "USD" } } }),
}));

listMocks.wallets.push({
  id: "wallet-1",
  name: "Cash",
  currency: "USD",
  opening_balance: "10.00",
  archived_at: null,
  balance: { amount: "12.00", as_of: "2026-08-24T00:00:00Z", currency: "USD" },
});

vi.mock("../generated/api", () => ({
  useListCurrencies: () => ({
    data: { data: [{ code: "USD", display_name: "US Dollar", exponent: 2 }] },
    isPending: false,
    isError: false,
  }),
  useCreateWallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWallet: () => ({ mutateAsync: listMocks.update, isPending: false }),
  getListWalletsQueryKey: () => ["/api/v1/wallets"],
  getGetWalletQueryKey: (id: string) => ["/api/v1/wallets", id],
  getGetTransactionEntryDefaultsQueryKey: () => ["/api/v1/transactions/entry-defaults"],
  getListRecurringTransactionsQueryKey: () => ["/api/v1/recurring-transactions"],
  useListWallets: () => ({
    data:
      listMocks.state === "success" || listMocks.state === "empty"
        ? { data: listMocks.state === "empty" ? [] : listMocks.wallets }
        : undefined,
    isPending: listMocks.state === "loading",
    isError: listMocks.state === "error",
    refetch: vi.fn(),
  }),
  useArchiveWallet: () => ({ mutateAsync: listMocks.archive, isPending: false }),
  useRestoreWallet: () => ({ mutateAsync: listMocks.restore, isPending: false }),
  useDeleteWallet: () => ({ mutateAsync: listMocks.remove, isPending: false }),
}));

import { WalletForm } from "../features/wallets/wallet-form";
import { WalletList } from "../features/wallets/wallet-list";

function renderWalletList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WalletList />
    </QueryClientProvider>,
  );
}

describe("wallet UX validation", () => {
  it("trims Unicode names without truncating exact 80-character input", () => {
    const name = `  ${"🪨".repeat(80)}  `;
    const parsed = walletSchema.safeParse({ name, currency: "USD", opening_balance: "0.00" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("🪨".repeat(80));
  });

  it("rejects empty and 81-character names", () => {
    expect(
      walletSchema.safeParse({ name: "   ", currency: "USD", opening_balance: "0" }).success,
    ).toBe(false);
    expect(
      walletSchema.safeParse({ name: "a".repeat(81), currency: "USD", opening_balance: "0" })
        .success,
    ).toBe(false);
  });

  it("keeps currency read-only while allowing opening balance edits", () => {
    render(
      <WalletForm
        wallet={{
          id: "wallet-1",
          name: "Cash",
          currency: "USD",
          opening_balance: "10.00",
          archived_at: null,
          balance: { amount: "10.00", as_of: "2026-08-24T00:00:00Z", currency: "USD" },
        }}
      />,
    );
    expect(screen.getByText(/Currency cannot be changed/)).toBeTruthy();
    expect(screen.getByLabelText("Currency")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Opening balance")).toHaveProperty("disabled", false);
  });

  it("keeps over-limit wallet text visible so validation can explain rejection", async () => {
    render(<WalletForm />);
    const input = screen.getByLabelText<HTMLInputElement>("Wallet name");
    expect(input.getAttribute("maxlength")).toBeNull();
    fireEvent.change(input, { target: { value: "x".repeat(81) } });
    expect(input.value).toBe("x".repeat(81));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("80 characters or fewer");
    });
  });

  it("sends exact editable opening balance and omits unchanged currency", async () => {
    listMocks.update.mockClear();
    render(<WalletForm wallet={{ ...listMocks.wallets[0] }} />);
    fireEvent.change(screen.getByLabelText("Opening balance"), { target: { value: "25.00" } });
    const save = screen.getByRole("button", { name: "Save wallet" });
    await waitFor(() => expect(save).toHaveProperty("disabled", false));
    fireEvent.click(save);
    await waitFor(() => expect(listMocks.update).toHaveBeenCalledWith({ walletId: "wallet-1", data: { opening_balance: "25.00" } }));
  });

  it("renders loading, error, and empty wallet states", () => {
    listMocks.state = "loading";
    const loading = renderWalletList();
    expect(screen.getByText("Loading wallets…")).toBeTruthy();
    loading.unmount();
    listMocks.state = "error";
    const error = renderWalletList();
    expect(screen.getByText("Could not load wallets.")).toBeTruthy();
    error.unmount();
    listMocks.state = "empty";
    renderWalletList();
    expect(screen.getByText("No wallets yet")).toBeTruthy();
    listMocks.state = "success";
  });

  it("confirms archive, displays server pause count, restores, and reports delete conflict", async () => {
    listMocks.state = "success";
    listMocks.archive.mockClear();
    listMocks.restore.mockClear();
    listMocks.remove.mockClear();
    const initial = renderWalletList();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Cash" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(screen.getByText(/pauses dependent recurring rules/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Archive wallet" }));
    await waitFor(() => {
      expect(screen.getByText("Wallet archived. 2 recurring rules paused.")).toBeTruthy();
    });
    listMocks.wallets[0] = { ...listMocks.wallets[0], archived_at: "2026-08-24T00:00:00Z" };
    initial.unmount();
    const restored = renderWalletList();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Cash" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Restore" }));
    await waitFor(() => {
      expect(screen.getByText(/Recurring rules stay paused/)).toBeTruthy();
    });
    restored.unmount();
    renderWalletList();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Cash" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete forever" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => {
      expect(screen.getByText(/cannot be deleted while it has history/)).toBeTruthy();
    });
    listMocks.wallets[0] = { ...listMocks.wallets[0], archived_at: null };
  });
});
