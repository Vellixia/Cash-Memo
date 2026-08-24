import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  preferences: vi.fn().mockResolvedValue({ data: {} }),
  logout: vi.fn().mockResolvedValue({ data: {} }),
  revoke: vi.fn().mockResolvedValue({ data: {} }),
  deletion: vi.fn().mockResolvedValue({ data: { status: "pending_deletion", deletion_due_at: "2026-08-31T00:00:00Z" } }),
  routes: [] as string[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: (path: string) => api.routes.push(path), push: vi.fn() }), usePathname: () => "/app/settings" }));
vi.mock("../generated/api", () => ({
  useGetOnboarding: () => ({ data: { data: { timezone_configured: true, default_currency_configured: true, default_currency_code: "USD", starter_categories_seeded: true, wallet_count: 1 } }, isPending: false, isError: false }),
  useListCurrencies: () => ({ data: { data: [{ code: "USD", display_name: "US Dollar", exponent: 2 }, { code: "IDR", display_name: "Indonesian Rupiah", exponent: 0 }] }, isPending: false, isError: false }),
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
  beforeEach(() => { api.routes.length = 0; api.preferences.mockClear(); api.logout.mockClear(); api.revoke.mockClear(); api.deletion.mockClear(); });

  it("saves timezone and default currency while explaining server-owned semantics", async () => {
    const { PreferencesForm } = await import("../features/settings/preferences-form");
    setup(<PreferencesForm />);
    expect(screen.getByText(/Timezone defines server reporting months, local dates, and recurring schedules/)).toBeTruthy();
    expect(screen.getByText(/Default currency only preselects new entries; it never converts or combines currencies/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "Asia/Jakarta" } });
    fireEvent.change(screen.getByLabelText("Default currency"), { target: { value: "IDR" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => { expect(api.preferences).toHaveBeenCalledWith({ data: { timezone: "Asia/Jakarta", default_currency_code: "IDR" } }); });
  });

  it("clears private query state after current-session and all-session logout", async () => {
    const { SessionControls } = await import("../features/settings/session-controls");
    const current = setup(<SessionControls />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out this session" }));
    await waitFor(() => { expect(current.client.getQueryCache().getAll()).toHaveLength(0); });
    current.unmount();
    const all = setup(<SessionControls />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out all sessions" }));
    await waitFor(() => { expect(all.client.getQueryCache().getAll()).toHaveLength(0); });
  });

  it("requires recent password, states grace and backup retention, then enters deletion-only access", async () => {
    const { AccountDeletion } = await import("../features/settings/account-deletion");
    const { client } = setup(<AccountDeletion />);
    expect(screen.getByText(/7-day grace period/)).toBeTruthy();
    expect(screen.getByText(/encrypted backups may retain deleted data after the grace period according to the backup retention schedule/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "recent secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule account deletion" }));
    await waitFor(() => { expect(api.deletion).toHaveBeenCalledWith({ data: { password: "recent secret" } }); });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(api.routes).toContain("/deletion");
  });
});
