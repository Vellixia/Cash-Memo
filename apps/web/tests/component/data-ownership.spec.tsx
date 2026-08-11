import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AccountDeletionFlow,
  type AccountDeletionPort,
  type AccountDeletionView,
} from "../../src/features/deletion/AccountDeletionFlow.js";
import {
  ExportCenter,
  type ExportCenterPort,
  type ExportJobView,
} from "../../src/features/export/ExportCenter.js";

const readyExport: ExportJobView = {
  deletedAt: null,
  expiresAt: "2026-08-12T00:00:00.000Z",
  failureCode: null,
  id: "00000000-0000-4000-8000-000000000169",
  readyAt: "2026-08-11T00:00:00.000Z",
  requestedAt: "2026-08-11T00:00:00.000Z",
  revision: "3",
  schemaVersion: "1.0",
  state: "ready",
};

const grace: AccountDeletionView = {
  graceEndsAt: "2026-08-18T00:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000174",
  livePurgeDueAt: null,
  livePurgedAt: null,
  providerState: "not_started",
  requestedAt: "2026-08-11T00:00:00.000Z",
  revision: "1",
  state: "grace",
};

function exportApi(overrides: Partial<ExportCenterPort> = {}): ExportCenterPort {
  return {
    cancel: vi.fn(async (): Promise<ExportJobView> => ({ ...readyExport, state: "canceled" })),
    download: vi.fn(async () => new Blob(["zip"])),
    list: vi.fn(async () => []),
    request: vi.fn(async () => readyExport),
    ...overrides,
  };
}

function deletionApi(overrides: Partial<AccountDeletionPort> = {}): AccountDeletionPort {
  return {
    cancel: vi.fn(async () => undefined),
    request: vi.fn(async () => grace),
    status: vi.fn(async () => null),
    ...overrides,
  };
}

describe("US8 data ownership UI", () => {
  it("requires password confirmation and shows export disclosures without storage URL", async () => {
    const request = vi.fn(async () => readyExport);
    render(<ExportCenter api={exportApi({ request })} />);
    await screen.findByText("No exports requested.");
    expect(screen.getByRole("button", { name: "Request export" })).toBeDisabled();
    fireEvent.change(screen.getByTestId("export-password"), { target: { value: "synthetic" } });
    fireEvent.click(screen.getByRole("button", { name: "Request export" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({ includeRecoverableDrafts: false }, "synthetic"),
    );
    expect(await screen.findByText("Available")).toBeInTheDocument();
    expect(screen.getByTestId("export-center").textContent).not.toMatch(/s3|bucket|https?:\/\//iu);
    expect(screen.getByTestId("export-center")).toHaveTextContent("No currency conversion");
  });

  it("renders failed/expired export states honestly", async () => {
    render(
      <ExportCenter
        api={exportApi({
          list: vi.fn(async (): Promise<readonly ExportJobView[]> => [
            { ...readyExport, failureCode: "STORAGE_UNAVAILABLE", state: "failed" },
            { ...readyExport, id: crypto.randomUUID(), state: "expired" },
          ]),
        })}
      />,
    );
    expect(await screen.findByText("Export failed")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText(/Package is inaccessible/)).toBeInTheDocument();
  });

  it("requires destructive confirmation and recent password before grace", async () => {
    const request = vi.fn(async () => grace);
    render(<AccountDeletionFlow api={deletionApi({ request })} />);
    await screen.findByRole("button", { name: "Start account deletion" });
    const start = screen.getByRole("button", { name: "Start account deletion" });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I understand journal access/));
    fireEvent.change(screen.getByTestId("account-deletion-password"), {
      target: { value: "synthetic" },
    });
    fireEvent.click(start);
    expect(await screen.findByTestId("account-deletion-grace")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("synthetic");
  });

  it("distinguishes irreversible, provider-pending, and failed states from completion", async () => {
    const { rerender } = render(
      <AccountDeletionFlow
        api={deletionApi({
          status: vi.fn(async (): Promise<AccountDeletionView> => ({ ...grace, state: "purging" })),
        })}
      />,
    );
    expect(await screen.findByTestId("account-deletion-purging")).toBeInTheDocument();
    rerender(
      <AccountDeletionFlow
        api={deletionApi({
          status: vi.fn(async (): Promise<AccountDeletionView> => ({
            ...grace,
            providerState: "escalated",
            state: "provider_pending",
          })),
        })}
      />,
    );
    expect(await screen.findByTestId("account-deletion-provider-pending")).toHaveTextContent(
      "Backup aging remains pending",
    );
    expect(screen.queryByText(/all your data is permanently deleted/iu)).toBeNull();
  });
});
