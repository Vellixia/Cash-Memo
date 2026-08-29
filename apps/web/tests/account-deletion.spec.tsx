import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  routes: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (path: string) => api.routes.push(path) }),
}));
vi.mock("../generated/api", () => ({
  useRequestAccountDeletion: () => ({ mutateAsync: api.request, isPending: false }),
}));

afterEach(() => {
  cleanup();
  api.request.mockReset();
  api.routes.length = 0;
});

describe("account deletion request", () => {
  it("renders authoritative server deadline and retention copy after successful request", async () => {
    api.request.mockResolvedValueOnce({
      data: {
        status: "pending_deletion",
        deletion_due_at: "2026-09-05T12:30:00Z",
      },
    });
    const { AccountDeletion } = await import("../features/settings/account-deletion");
    const client = new QueryClient();
    client.setQueryData(["financial"], { amount: "synthetic" });
    render(
      <QueryClientProvider client={client}>
        <AccountDeletion />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/7-day grace period/)).toBeTruthy();
    expect(screen.getByText(/encrypted backups may retain deleted data/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "recent secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule account deletion" }));

    await waitFor(() => expect(api.routes).toContain("/deletion"));
    expect(screen.getByText(/September 5, 2026/)).toBeTruthy();
    expect(client.getQueryData(["financial"])).toBeUndefined();
  });
});

describe("private query isolation", () => {
  it("shows legacy cancellation-only cleanup leaves prior private data reusable", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["financial", "legacy"];
    const sentinel = { secret: "user A financial sentinel" };
    client.setQueryData(key, sentinel);
    let resolve!: (value: typeof sentinel) => void;
    const request = client.fetchQuery({
      queryKey: key,
      queryFn: () => new Promise<typeof sentinel>((done) => { resolve = done; }),
    });

    // This is the old isolated cleanup shape: cancel, but leave reusable QueryClient state alive.
    await client.cancelQueries();
    expect(client.getQueryData(key)).toEqual(sentinel);
    resolve(sentinel);
    await request.catch(() => undefined);
  });

  it("aborts in-flight financial requests and blocks late results from returning to cache", async () => {
    const { clearPrivateQueryState } = await import("../lib/query-client");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cancelSpy = vi.spyOn(client, "cancelQueries");
    const key = ["financial", "late"];
    client.setQueryData(key, { secret: "user A financial sentinel" });
    let resolve!: (value: { secret: string }) => void;
    const request = client.fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        return new Promise<{ secret: string }>((done) => {
          resolve = done;
        });
      },
    }).catch(() => undefined);

    await clearPrivateQueryState(client);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    resolve({ secret: "late private result" });
    await request;
    await new Promise((done) => setTimeout(done, 0));

    expect(client.getQueryData(key)).toBeUndefined();
  });
});
