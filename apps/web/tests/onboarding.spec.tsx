import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  onboardingComplete,
  onboardingNextStep,
  type OnboardingStep,
} from "../features/onboarding/use-onboarding";
import type { OnboardingContract } from "../generated/api/model/onboardingContract";

const mocks = vi.hoisted(() => {
  const state: OnboardingContract = {
    timezone_configured: true,
    timezone: "Asia/Jakarta",
    default_currency_configured: false,
    default_currency_code: null,
    categories_seeded: true,
    has_active_wallet: true,
  };
  return {
    queryState: "success",
    currencyState: "success",
    state,
    currencies: [
      { code: "USD", display_name: "US Dollar", exponent: 2 },
      { code: "EUR", display_name: "Euro", exponent: 2 },
    ],
    save: vi.fn().mockResolvedValue({ data: {} }),
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
    retryCurrencies: vi.fn().mockResolvedValue(undefined),
    routes: [] as string[],
  };
});

vi.mock("../generated/api", () => ({
  getGetOnboardingQueryKey: () => ["/api/v1/onboarding"],
  getListCategoriesQueryKey: () => ["/api/v1/categories"],
  useGetOnboarding: () => ({
    data: mocks.queryState === "success" ? { data: mocks.state } : undefined,
    isPending: mocks.queryState === "loading",
    isError: mocks.queryState === "error",
    refetch: mocks.refetch,
  }),
  useListCurrencies: () => ({
    data: mocks.currencyState === "success" ? { data: mocks.currencies } : undefined,
    isPending: mocks.currencyState === "loading",
    isError: mocks.currencyState === "error",
    refetch: mocks.retryCurrencies,
  }),
  useUpdatePreferences: () => ({ mutateAsync: mocks.save, isPending: false }),
  useCreateWallet: () => ({ mutateAsync: mocks.walletCreate, isPending: false }),
  useUpdateWallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (path: string) => mocks.routes.push(path) }),
}));

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

function contract(overrides: Partial<OnboardingContract>): OnboardingContract {
  return {
    timezone_configured: true,
    timezone: "Asia/Jakarta",
    default_currency_configured: true,
    default_currency_code: "USD",
    categories_seeded: true,
    has_active_wallet: true,
    ...overrides,
  };
}

import { OnboardingFlow } from "../features/onboarding/onboarding-flow";

describe("derived onboarding", () => {
  beforeEach(() => {
    cleanup();
    mocks.queryState = "success";
    mocks.currencyState = "success";
    mocks.state = contract({ default_currency_configured: false, default_currency_code: null });
    mocks.save.mockReset().mockResolvedValue({ data: {} });
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
    mocks.retryCurrencies.mockClear();
    mocks.routes.length = 0;
  });

  it("derives exactly three visible steps from backend facts and never a category step", () => {
    const observed = new Set<OnboardingStep>();
    for (const timezone_configured of [false, true]) {
      for (const default_currency_configured of [false, true]) {
        for (const categories_seeded of [false, true]) {
          for (const has_active_wallet of [false, true]) {
            const state = contract({
              timezone_configured,
              timezone: timezone_configured ? "Asia/Jakarta" : null,
              default_currency_configured,
              default_currency_code: default_currency_configured ? "USD" : null,
              categories_seeded,
              has_active_wallet,
            });
            const step = onboardingNextStep(state);
            observed.add(step);
            const expected = !timezone_configured
              ? "timezone"
              : !default_currency_configured
                ? "currency"
                : !has_active_wallet
                  ? "wallet"
                  : "complete";
            expect(step).toBe(expected);
            expect(onboardingComplete(state)).toBe(expected === "complete");
          }
        }
      }
    }
    expect([...observed].sort()).toEqual(["complete", "currency", "timezone", "wallet"]);
  });

  it("keeps a completed account whose only wallet was archived inside the app", async () => {
    // The backend reports `has_active_wallet` as "onboarding completed OR an active wallet exists",
    // and reconciles category seeding itself. Neither may reopen setup on the client.
    mocks.state = contract({ categories_seeded: false });
    renderOnboarding();

    await waitFor(() => {
      expect(mocks.routes).toEqual(["/app"]);
    });
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("never renders a starter-category step", () => {
    mocks.state = contract({ categories_seeded: false, has_active_wallet: false });
    renderOnboarding();

    expect(screen.getByRole("heading", { name: "Create wallet", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add starter categories" })).toBeNull();
    expect(screen.queryByText(/starter categories/i)).toBeNull();
  });

  it("offers the browser-detected zone first and stores the exact IANA value", async () => {
    mocks.state = contract({ timezone_configured: false, timezone: null });
    renderOnboarding();

    const timezone = screen.getByLabelText<HTMLInputElement>("Reporting timezone");
    fireEvent.keyDown(timezone, { key: "ArrowDown" });
    const options = await screen.findAllByRole("option");
    expect(options[0]?.textContent).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);

    fireEvent.change(timezone, { target: { value: "Asia/Jakarta" } });
    fireEvent.click(await screen.findByRole("option", { name: "Asia/Jakarta" }));
    expect(timezone.value).toBe("Asia/Jakarta");

    fireEvent.change(screen.getByLabelText("Default currency"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save timezone and currency" }));
    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith({
        data: { timezone: "Asia/Jakarta", default_currency_code: "USD" },
      });
    });
  });

  it("re-derives the step from the server after saving instead of advancing locally", async () => {
    mocks.state = contract({ timezone_configured: false, timezone: null });
    renderOnboarding();

    const timezone = screen.getByLabelText<HTMLInputElement>("Reporting timezone");
    fireEvent.keyDown(timezone, { key: "ArrowDown" });
    fireEvent.change(timezone, { target: { value: "Asia/Jakarta" } });
    fireEvent.click(await screen.findByRole("option", { name: "Asia/Jakarta" }));
    fireEvent.change(screen.getByLabelText("Default currency"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save timezone and currency" }));

    await waitFor(() => {
      expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["/api/v1/onboarding"] });
    });
    // The mocked backend still reports an unconfigured timezone, so the step must not advance.
    expect(screen.getByRole("heading", { name: "Confirm your timezone", level: 2 })).toBeTruthy();
  });

  it("shows the same step after a refresh or Back returns to the flow", () => {
    mocks.state = contract({ default_currency_configured: false, default_currency_code: null });
    const first = renderOnboarding();
    expect(screen.getByRole("heading", { name: "Choose your default currency", level: 2 })).toBeTruthy();
    first.unmount();

    renderOnboarding();
    expect(screen.getByRole("heading", { name: "Choose your default currency", level: 2 })).toBeTruthy();
  });

  it("requires explicit currency choice and sends only the selected registry value", async () => {
    mocks.state = contract({
      timezone: "America/New_York",
      default_currency_configured: false,
      default_currency_code: null,
    });
    renderOnboarding();
    const save = screen.getByRole("button", { name: "Save currency" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Default currency"), { target: { value: "EUR" } });
    expect(save).toHaveProperty("disabled", false);
    fireEvent.click(save);
    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith({
        data: { timezone: "America/New_York", default_currency_code: "EUR" },
      });
    });
  });

  it("shows an explicit currency-registry pending state and suppresses validation until ready", () => {
    mocks.state = contract({
      timezone: "America/New_York",
      default_currency_configured: false,
      default_currency_code: null,
    });
    mocks.currencyState = "loading";
    renderOnboarding();

    const currency = screen.getByLabelText<HTMLInputElement>("Default currency");
    expect(currency.disabled).toBe(true);
    expect(currency.getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Loading supported currencies.");
    expect(screen.queryByText("Choose a supported currency code.")).toBeNull();
    expect(screen.getByRole("button", { name: "Save currency" })).toHaveProperty("disabled", true);
  });

  it("shows a retryable currency-registry error and recovers to a successful save", async () => {
    mocks.state = contract({
      timezone: "America/New_York",
      default_currency_configured: false,
      default_currency_code: null,
    });
    mocks.currencyState = "error";
    const first = renderOnboarding();

    expect(screen.getByRole("alert").textContent).toContain("Could not load supported currencies.");
    fireEvent.click(screen.getByRole("button", { name: "Retry currency registry" }));
    expect(mocks.retryCurrencies).toHaveBeenCalledTimes(1);
    first.unmount();

    mocks.currencyState = "success";
    renderOnboarding();
    fireEvent.change(screen.getByLabelText("Default currency"), { target: { value: "EUR" } });
    fireEvent.click(screen.getByRole("button", { name: "Save currency" }));

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith({
        data: { timezone: "America/New_York", default_currency_code: "EUR" },
      });
    });
  });

  it("offers a subordinate Back that reopens the saved timezone for correction", async () => {
    mocks.state = contract({
      timezone: "America/New_York",
      default_currency_configured: false,
      default_currency_code: null,
    });
    renderOnboarding();

    expect(screen.queryByLabelText("Reporting timezone")).toBeNull();
    const back = screen.getByRole("button", { name: "Back" });
    expect(back.getAttribute("aria-expanded")).toBe("false");
    // Subordinate actions follow the primary action in the DOM, so the primary is reached first.
    const primary = screen.getByRole("button", { name: "Save currency" });
    expect(primary.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(back);
    const timezone = await screen.findByLabelText<HTMLInputElement>("Reporting timezone");
    expect(timezone.value).toBe("America/New_York");
    expect(back.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a stable skeleton while loading and a retryable error panel", () => {
    mocks.queryState = "loading";
    const loading = renderOnboarding();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.getByText("Checking setup…")).toBeTruthy();
    loading.unmount();

    mocks.queryState = "error";
    renderOnboarding();
    expect(screen.getByRole("alert").textContent).toContain("Could not load your setup.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("reports a failed preferences save inline without losing the entered values", async () => {
    mocks.state = contract({
      timezone: "America/New_York",
      default_currency_configured: false,
      default_currency_code: null,
    });
    mocks.save.mockRejectedValueOnce(new Error("Temporary preference failure."));
    renderOnboarding();

    fireEvent.change(screen.getByLabelText("Default currency"), { target: { value: "EUR" } });
    fireEvent.click(screen.getByRole("button", { name: "Save currency" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Temporary preference failure.",
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Default currency").value).toBe("EUR");
  });

  it("reloads first-wallet onboarding with persisted default currency preselected", async () => {
    mocks.state = contract({ default_currency_code: "EUR", has_active_wallet: false });
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
