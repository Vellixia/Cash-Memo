import type {
  AccountDeletionPort,
  AccountDeletionView,
} from "../features/deletion/AccountDeletionFlow.js";
import type { ExportCenterPort, ExportJobView } from "../features/export/ExportCenter.js";

const API_BASE = "/api/v1";

async function jsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error("DATA_OWNERSHIP_REQUEST_FAILED");
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function reauthenticate(password: string, scope: "account_delete" | "export") {
  const response = await fetch(`${API_BASE}/auth/reauth`, {
    body: JSON.stringify({ password, scope: [scope] }),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return jsonResponse<{ readonly grantId: string }>(response);
}

export type DataOwnershipApi = ExportCenterPort & AccountDeletionPort;

export function createDataOwnershipApi(): DataOwnershipApi {
  return {
    async cancel(idOrRevision: string, revision?: string, password?: string) {
      if (revision === undefined) {
        const response = await fetch(`${API_BASE}/me/account-deletion`, {
          body: JSON.stringify({ expectedRevision: idOrRevision }),
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          method: "DELETE",
        });
        return jsonResponse<undefined>(response);
      }
      const grant = await reauthenticate(password ?? "", "export");
      const response = await fetch(`${API_BASE}/exports/${idOrRevision}`, {
        body: JSON.stringify({ expectedRevision: revision }),
        cache: "no-store",
        headers: { "Content-Type": "application/json", "x-reauth-grant": grant.grantId },
        method: "DELETE",
      });
      return jsonResponse<ExportJobView>(response);
    },

    async download(id: string, password: string) {
      const grant = await reauthenticate(password, "export");
      const response = await fetch(`${API_BASE}/exports/${id}/download`, {
        cache: "no-store",
        headers: { "x-reauth-grant": grant.grantId },
        method: "POST",
      });
      if (!response.ok) throw new Error("EXPORT_DOWNLOAD_FAILED");
      return response.blob();
    },

    async list() {
      const response = await fetch(`${API_BASE}/exports`, { cache: "no-store" });
      return jsonResponse<readonly ExportJobView[]>(response);
    },

    async request(
      inputOrPassword: { readonly includeRecoverableDrafts: boolean } | string,
      password?: string,
    ) {
      if (typeof inputOrPassword === "string") {
        const grant = await reauthenticate(inputOrPassword, "account_delete");
        const response = await fetch(`${API_BASE}/me/account-deletion`, {
          body: JSON.stringify({ confirmation: "DELETE_MY_CASHMEMO_ACCOUNT" }),
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
            "x-reauth-grant": grant.grantId,
          },
          method: "POST",
        });
        return jsonResponse<AccountDeletionView>(response);
      }
      const grant = await reauthenticate(password ?? "", "export");
      const response = await fetch(`${API_BASE}/exports`, {
        body: JSON.stringify({
          includeRecoverableDrafts: inputOrPassword.includeRecoverableDrafts,
          schemaVersion: "1.0",
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "x-reauth-grant": grant.grantId,
        },
        method: "POST",
      });
      return jsonResponse<ExportJobView>(response);
    },

    async status() {
      const response = await fetch(`${API_BASE}/me/account-deletion`, { cache: "no-store" });
      if (response.status === 404) return null;
      return jsonResponse<AccountDeletionView>(response);
    },
  } as DataOwnershipApi;
}
