import { describe, expect, it } from "vitest";

import type { CreateTransactionRequest } from "../generated/api/model/createTransactionRequest";
import type { EntryDefaults } from "../generated/api/model/entryDefaults";
import type { ExpenseCategoryContract } from "../generated/api/model/expenseCategoryContract";
import type { GetRecentTransactionsParams } from "../generated/api/model/getRecentTransactionsParams";
import type { TransactionContract } from "../generated/api/model/transactionContract";
import type { UpdateTransactionRequest } from "../generated/api/model/updateTransactionRequest";
import type { UpdateWalletRequest } from "../generated/api/model/updateWalletRequest";
import { api } from "../lib/api/axios";

describe("generated API transport", () => {
  it("sends an already-versioned generated path without duplicating its prefix", () => {
    expect(api.getUri({ url: "/api/v1/auth/register" })).toBe("/api/v1/auth/register");
  });

  it("exposes frozen repaired DTO fields in generated TypeScript", () => {
    const create: CreateTransactionRequest = {
      amount: "10.00",
      category_id: "category",
      direction: "expense",
      occurred_local: "2026-08-31T23:30",
      wallet_id: "wallet",
    };
    const update: UpdateTransactionRequest = { occurred_local: "2026-08-31T23:30" };
    const defaults: EntryDefaults = { last_used_wallet_id: null, timezone: "Asia/Jakarta" };
    const transaction: TransactionContract = {
      amount: "10.00",
      category_id: "category",
      category_name: "Dining",
      currency: "USD",
      direction: "expense",
      id: "transaction",
      occurred_at: "2026-08-31T16:30:00+00:00",
      wallet_id: "wallet",
      wallet_name: "Travel Cash",
    };
    const category: ExpenseCategoryContract = {
      category_id: "category",
      expense: "100.00",
      name: "Dining",
      share_percent: "100.00",
    };
    const wallet: UpdateWalletRequest = { opening_balance: "25.00" };
    const recent: GetRecentTransactionsParams = { month: "2026-08" };

    expect(create.occurred_local).toBe("2026-08-31T23:30");
    expect(update.occurred_local).toBe("2026-08-31T23:30");
    expect(defaults.timezone).toBe("Asia/Jakarta");
    expect(transaction.wallet_name).toBe("Travel Cash");
    expect(transaction.category_name).toBe("Dining");
    expect(category.share_percent).toBe("100.00");
    expect(wallet.opening_balance).toBe("25.00");
    expect(recent.month).toBe("2026-08");
  });
});
