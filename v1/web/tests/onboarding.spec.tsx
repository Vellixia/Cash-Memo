import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { onboardingComplete, onboardingNextStep } from "../features/onboarding/use-onboarding";

const mocks = vi.hoisted(() => ({
  queryState: "success",
  state: {
    timezone_configured: true,
    default_currency_configured: false,
    default_currency_code: null as string | null,
    categories_seeded: true,
    has_active_wallet: true,
  },
  currencies: [
    { code: "USD", display_name: "US Dollar", exponent: 2 },
    { code: "EUR", display_name: "Euro", exponent: 2 },
  ],
  save: vi.fn().mockResolvedValue({ data: {} }),
  seed: vi.fn().mockResolvedValue({ data: undefined }),
  walletCreate: vi.fn().mockResolvedValue({
    data: {
      id: "wallet-1",
      name: "Cash",
      currency: "USD",
      opening_balance: "125.00",
      archived_at: null,
      balance: { amount: "125.00", as_of: "2026-08-24T00:00:00Z", currency: "USD" },
    },
  }),
  invalidate: vi.fn().mockResolvedValue(undefined),
  refetch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../generated/api", () => ({
  getGetOnboardingQueryKey: () => ["/api/v1/onboarding"],
  getListCategoriesQueryKey: () => ["/api/v1/categories"],
  useGetOnboarding: () => ({
    data: mocks.queryState === "success" ? { data: mocks.state } : undefined,
    isPending: mocks.queryState === "loading",
    isError: mocks.queryState === "error",
    refetch: mocks.refetch,
  }),
  useListCurrencies: () => ({ data: { data: mocks.currencies }, isPending: false, isError: false }),
  useUpdatePreferences: () => ({ mutateAsync: mocks.save, isPending: false }),
  useSeedOnboardingCategories: () => ({ mutateAsync: mocks.seed, isPending: false }),
  useCreateWallet: () => ({ mutateAsync: mocks.walletCreate, isPending: false }),
  useUpdateWallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

function renderOnboarding() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(client, "invalidateQueries").mockImplementation(mocks.invalidate);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <OnboardingFlow />
      </QueryClientProvider>,
    ),
  };
}

import { getTimezoneOptions, OnboardingFlow } from "../features/onboarding/onboarding-flow";

describe("derived onboarding", () => {
  beforeEach(() => {
    mocks.queryState = "success";
    mocks.state = {
      timezone_configured: true,
      default_currency_configured: false,
      default_currency_code: null,
      categories_seeded: true,
      has_active_wallet: true,
    };
    mocks.save.mockReset().mockResolvedValue({ data: {} });
    mocks.seed.mockReset().mockResolvedValue({ data: undefined });
    mocks.walletCreate.mockReset().mockResolvedValue({
      data: {
        id: "wallet-1",
        name: "Cash",
        currency: "USD",
        opening_balance: "125.00",
        archived_at: null,
        balance: { amount: "125.00", as_of: "2026-08-24T00:00:00Z", currency: "USD" },
      },
    });
    mocks.invalidate.mockClear();
    mocks.refetch.mockClear();
  });

  it("only completes when every backend fact is true", () => {
    expect(
      onboardingComplete({
        timezone_configured: true,
        default_currency_configured: true,
        default_currency_code: "USD",
        categories_seeded: true,
        has_active_wallet: true,
      }),
    ).toBe(true);
    expect(
      onboardingComplete({
        timezone_configured: true,
        default_currency_configured: true,
        default_currency_code: "USD",
        categories_seeded: true,
        has_active_wallet: false,
      }),
    ).toBe(false);
  });

  it("returns missing step from server facts, so interruption is safe", () => {
    expect(
      onboardingNextStep({
        timezone_configured: false,
        default_currency_configured: true,
        default_currency_code: "USD",
        categories_seeded: true,
        has_active_wallet: true,
      }),
    ).toBe("timezone");
    expect(
      onboardingNextStep({
        timezone_configured: true,
        default_currency_configured: false,
        default_currency_code: null,
        categories_seeded: true,
        has_active_wallet: true,
      }),
    ).toBe("currency");
    expect(
      onboardingNextStep({
        timezone_configured: true,
        default_currency_configured: true,
        default_currency_code: "USD",
        categories_seeded: false,
        has_active_wallet: true,
      }),
    ).toBe("categories");
    expect(
      onboardingNextStep({
        timezone_configured: true,
        default_currency_configured: true,
        default_currency_code: "USD",
        categories_seeded: true,
        has_active_wallet: false,
      }),
    ).toBe("wallet");
  });

  it("requires explicit currency choice and sends only selected registry value", async () => {
    mocks.state = {
      timezone_configured: true,
      default_currency_configured: false,
      default_currency_code: null,
      categories_seeded: true,
      has_active_wallet: true,
    };
    mocks.save.mockClear();
    renderOnboarding();
    const save = screen.getByRole("button", { name: "Save currency" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Default currency"), { target: { value: "EUR" } });
    expect(save).toHaveProperty("disabled", false);
    fireEvent.click(save);
    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith({
        data: { timezone: getTimezoneOptions()[0] ?? "UTC", default_currency_code: "EUR" },
      });
    });
  });

  it("offers searchable IANA timezone choices and persists chosen value", async () => {
    mocks.state = {
      timezone_configured: false,
      default_currency_configured: true,
      default_currency_code: "USD",
      categories_seeded: true,
      has_active_wallet: true,
    };
    mocks.save.mockClear();
    renderOnboarding();
    const timezone = screen.getByLabelText("Reporting timezone");
    fireEvent.change(timezone, { target: { value: "Asia/Jakarta" } });
    fireEvent.change(screen.getByLabelText("Default currency"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save timezone and currency" }));
    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith({
        data: { timezone: "Asia/Jakarta", default_currency_code: "USD" },
      });
    });
    expect(timezone.getAttribute("list")).toBe("cashmemo-timezones");
    expect(
      document.querySelector('datalist#cashmemo-timezones option[value="Asia/Jakarta"]'),
    ).toBeTruthy();
  });

  it("shows loading and retryable onboarding load errors", () => {
    mocks.queryState = "loading";
    const loading = renderOnboarding();
    expect(screen.getByText("Checking setup…")).toBeTruthy();
    loading.unmount();

    mocks.queryState = "error";
    renderOnboarding();
    expect(screen.getByRole("alert").textContent).toContain("Could not load your setup.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("reports failed starter seeding, retries, and refreshes onboarding plus categories", async () => {
    mocks.state = {
      timezone_configured: true,
      default_currency_configured: true,
      default_currency_code: "USD",
      categories_seeded: false,
      has_active_wallet: true,
    };
    mocks.seed.mockRejectedValueOnce(new Error("Temporary seed failure."));
    renderOnboarding();
    fireEvent.click(screen.getByRole("button", { name: "Add starter categories" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Temporary seed failure.");

    fireEvent.click(screen.getByRole("button", { name: "Add starter categories" }));
    await waitFor(() => {
      expect(mocks.seed).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("status").textContent).toContain("Starter categories ready.");
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["/api/v1/onboarding"] });
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["/api/v1/categories"] });
  });

  it("reloads first-wallet onboarding with persisted default currency preselected", async () => {
    mocks.state = {
      timezone_configured: true,
      default_currency_configured: true,
      default_currency_code: "EUR",
      categories_seeded: true,
      has_active_wallet: false,
    };
    renderOnboarding();

    expect(screen.getByLabelText<HTMLSelectElement>("Currency").value).toBe("EUR");
    fireEvent.change(screen.getByLabelText("Wallet name"), { target: { value: "Cash" } });
    fireEvent.change(screen.getByLabelText("Opening balance"), { target: { value: "125.00" } });
    const submit = screen.getByRole("button", { name: "Create first wallet" });
    await waitFor(() => {
      expect(submit).toHaveProperty("disabled", false);
    });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mocks.walletCreate).toHaveBeenCalledWith({
        data: { name: "Cash", currency: "EUR", opening_balance: "125.00" },
      });
    });
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["/api/v1/onboarding"] });
  });
});
