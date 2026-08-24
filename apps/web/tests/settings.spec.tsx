import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  onboardingState: "success",
  currencyState: "success",
  retryOnboarding: vi.fn(),
  retryCurrencies: vi.fn(),
  preferences: vi.fn().mockResolvedValue({ data: {} }),
  logout: vi.fn().mockResolvedValue({ data: {} }),
  revoke: vi.fn().mockResolvedValue({ data: {} }),
  deletion: vi.fn().mockResolvedValue({
    data: { status: "pending_deletion", deletion_due_at: "2026-08-31T00:00:00Z" },
  }),
  routes: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (path: string) => api.routes.push(path), push: vi.fn() }),
  usePathname: () => "/app/settings",
}));
vi.mock("../generated/api", () => ({
  useGetOnboarding: () => ({
    data:
      api.onboardingState === "success"
        ? {
            data: {
              timezone_configured: true,
              timezone: "America/New_York",
              default_currency_configured: true,
              default_currency_code: "USD",
              starter_categories_seeded: true,
              wallet_count: 1,
            },
          }
        : undefined,
    isPending: api.onboardingState === "loading",
    isError: api.onboardingState === "error",
    refetch: api.retryOnboarding,
  }),
  useListCurrencies: () => ({
    data:
      api.currencyState === "success"
        ? {
            data: [
              { code: "USD", display_name: "US Dollar", exponent: 2 },
              { code: "IDR", display_name: "Indonesian Rupiah", exponent: 0 },
            ],
          }
        : undefined,
    isPending: api.currencyState === "loading",
    isError: api.currencyState === "error",
    refetch: api.retryCurrencies,
  }),
  useUpdatePreferences: () => ({ mutateAsync: api.preferences, isPending: false }),
  useLogout: () => ({ mutateAsync: api.logout, isPending: false }),
  useRevokeAllSessions: () => ({ mutateAsync: api.revoke, isPending: false }),
  useRequestAccountDeletion: () => ({ mutateAsync: api.deletion, isPending: false }),
  getGetOnboardingQueryKey: () => ["/api/v1/onboarding"],
}));

function setup(node: React.ReactNode) {
  const client = new QueryClient();
  client.setQueryData(["private"], { secret: true });
  return { client, ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>) };
}

describe("settings", () => {
  beforeEach(() => {
    cleanup();
    api.routes.length = 0;
    api.onboardingState = "success";
    api.currencyState = "success";
    api.preferences.mockClear();
    api.logout.mockClear();
    api.revoke.mockClear();
    api.deletion.mockClear();
    api.retryOnboarding.mockClear();
    api.retryCurrencies.mockClear();
  });

  it("saves timezone and default currency while explaining server-owned semantics", async () => {
    const { PreferencesForm } = await import("../features/settings/preferences-form");
    setup(<PreferencesForm />);
    expect(
      screen.getByText(
        /Timezone defines server reporting months, local dates, and recurring schedules/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Default currency only preselects new entries; it never converts or combines currencies/,
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "Asia/Jakarta" } });
    fireEvent.change(screen.getByLabelText("Default currency"), { target: { value: "IDR" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => {
      expect(api.preferences).toHaveBeenCalledWith({
        data: { timezone: "Asia/Jakarta", default_currency_code: "IDR" },
      });
    });
  });

  it("reappears with persisted timezone and submits it unchanged while offering broad IANA choices", async () => {
    const { PreferencesForm } = await import("../features/settings/preferences-form");
    const first = setup(<PreferencesForm />);
    expect(screen.getByLabelText<HTMLInputElement>("Timezone").value).toBe("America/New_York");
    expect(
      document.querySelector('datalist#settings-timezones option[value="Europe/London"]'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => {
      expect(api.preferences).toHaveBeenCalledWith({
        data: { timezone: "America/New_York", default_currency_code: "USD" },
      });
    });
    first.unmount();
    setup(<PreferencesForm />);
    expect(screen.getByLabelText<HTMLInputElement>("Timezone").value).toBe("America/New_York");
  });

  it("does not expose browser defaults while authoritative preferences are pending or failed", async () => {
    const { PreferencesForm } = await import("../features/settings/preferences-form");
    api.onboardingState = "loading";
    const pending = setup(<PreferencesForm />);
    expect(screen.getByText("Loading preferences…")).toBeTruthy();
    expect(screen.queryByLabelText("Timezone")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save preferences" })).toBeNull();
    pending.unmount();

    api.onboardingState = "error";
    setup(<PreferencesForm />);
    expect(screen.getByText("Could not load preferences.")).toBeTruthy();
    expect(screen.queryByLabelText("Timezone")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry preferences" }));
    expect(api.retryOnboarding).toHaveBeenCalled();
    expect(api.preferences).not.toHaveBeenCalled();
  });

  it("keeps preference mutation failures form-level", async () => {
    const { PreferencesForm } = await import("../features/settings/preferences-form");
    api.preferences.mockRejectedValueOnce(new Error("preferences unavailable"));
    setup(<PreferencesForm />);
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(await screen.findByText("preferences unavailable")).toBeTruthy();
    expect(screen.getByLabelText("Timezone").getAttribute("aria-invalid")).toBeNull();
  });

  it("links required preference errors to both controls and clears each error on edit", async () => {
    const { PreferencesForm } = await import("../features/settings/preferences-form");
    setup(<PreferencesForm />);
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Default currency"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    const timezone = screen.getByLabelText("Timezone");
    const currency = screen.getByLabelText("Default currency");
    expect(timezone.getAttribute("aria-invalid")).toBe("true");
    expect(timezone.getAttribute("aria-describedby")).toBe("settings-timezone-error");
    expect(screen.getByText("Choose a timezone.").id).toBe("settings-timezone-error");
    expect(currency.getAttribute("aria-invalid")).toBe("true");
    expect(currency.getAttribute("aria-describedby")).toBe("settings-currency-error");
    expect(screen.getByText("Choose a default currency.").id).toBe("settings-currency-error");
    expect(api.preferences).not.toHaveBeenCalled();

    fireEvent.change(timezone, { target: { value: "Asia/Jakarta" } });
    expect(timezone.getAttribute("aria-invalid")).toBeNull();
    expect(currency.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(currency, { target: { value: "IDR" } });
    expect(currency.getAttribute("aria-invalid")).toBeNull();
  });

  it("clears private query state after current-session and all-session logout", async () => {
    const { SessionControls } = await import("../features/settings/session-controls");
    const current = setup(<SessionControls />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out this session" }));
    await waitFor(() => {
      expect(current.client.getQueryCache().getAll()).toHaveLength(0);
    });
    current.unmount();
    const all = setup(<SessionControls />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out all sessions" }));
    await waitFor(() => {
      expect(all.client.getQueryCache().getAll()).toHaveLength(0);
    });
  });

  it("requires recent password, states grace and backup retention, then enters deletion-only access", async () => {
    const { AccountDeletion } = await import("../features/settings/account-deletion");
    const { client } = setup(<AccountDeletion />);
    expect(screen.getByText(/7-day grace period/)).toBeTruthy();
    expect(
      screen.getByText(
        /encrypted backups may retain deleted data after the grace period according to the backup retention schedule/,
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "recent secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule account deletion" }));
    await waitFor(() => {
      expect(api.deletion).toHaveBeenCalledWith({ data: { password: "recent secret" } });
    });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(api.routes).toContain("/deletion");
  });

  it("links a missing deletion password but keeps request failures form-level", async () => {
    const { AccountDeletion } = await import("../features/settings/account-deletion");
    const blank = setup(<AccountDeletion />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule account deletion" }));
    const password = screen.getByLabelText("Current password");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-describedby")).toBe("deletion-password-error");
    expect(api.deletion).not.toHaveBeenCalled();
    blank.unmount();

    api.deletion.mockRejectedValueOnce(new Error("recent password rejected"));
    setup(<AccountDeletion />);
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule account deletion" }));
    expect(await screen.findByText("recent password rejected")).toBeTruthy();
    expect(screen.getByLabelText("Current password").getAttribute("aria-invalid")).toBeNull();
  });
});
