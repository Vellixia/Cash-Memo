import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { walletSchema } from "../lib/validation/wallet";

vi.mock("../generated/api", () => ({
  useListCurrencies: () => ({ data: { data: [{ code: "USD", display_name: "US Dollar", exponent: 2 }] }, isPending: false, isError: false }),
  useCreateWallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { WalletForm } from "../features/wallets/wallet-form";

describe("wallet UX validation", () => {
  it("trims Unicode names without truncating exact 80-character input", () => {
    const name = `  ${"🪨".repeat(80)}  `;
    const parsed = walletSchema.safeParse({ name, currency: "USD", opening_balance: "0.00" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("🪨".repeat(80));
  });

  it("rejects empty and 81-character names", () => {
    expect(walletSchema.safeParse({ name: "   ", currency: "USD", opening_balance: "0" }).success).toBe(false);
    expect(walletSchema.safeParse({ name: "a".repeat(81), currency: "USD", opening_balance: "0" }).success).toBe(false);
  });

  it("makes currency and opening balance visibly immutable while editing", () => {
    render(<WalletForm wallet={{ id: "wallet-1", name: "Cash", currency: "USD", opening_balance: "10.00", archived_at: null, balance: { amount: "10.00", as_of: "2026-08-24T00:00:00Z", currency: "USD" } }} />);
    expect(screen.getByText(/Currency and opening balance cannot be changed/)).toBeTruthy();
    expect(screen.getByLabelText("Currency")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Opening balance")).toHaveProperty("disabled", true);
  });
});
