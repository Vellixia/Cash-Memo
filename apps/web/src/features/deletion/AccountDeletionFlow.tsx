import { useCallback, useEffect, useState } from "react";

import { DeletionDisclosures } from "./DeletionDisclosures.js";

type AccountDeletionState =
  "canceled" | "complete" | "failed" | "grace" | "live_purged" | "provider_pending" | "purging";

interface AccountDeletionView {
  readonly graceEndsAt: string;
  readonly id: string;
  readonly livePurgeDueAt: string | null;
  readonly livePurgedAt: string | null;
  readonly providerState: "confirmed" | "escalated" | "not_required" | "not_started" | "pending";
  readonly requestedAt: string;
  readonly revision: string;
  readonly state: AccountDeletionState;
}

interface AccountDeletionPort {
  cancel(expectedRevision: string): Promise<void>;
  request(password: string): Promise<AccountDeletionView>;
  status(): Promise<AccountDeletionView | null>;
}

interface AccountDeletionFlowProps {
  readonly api: AccountDeletionPort;
}

function DeletionState({ deletion }: { readonly deletion: AccountDeletionView }) {
  if (deletion.state === "grace") {
    return (
      <div data-testid="account-deletion-grace" role="status">
        <h3>Deletion grace period</h3>
        <p>Journal access is suspended. You may cancel until {deletion.graceEndsAt}.</p>
      </div>
    );
  }
  if (deletion.state === "purging") {
    return (
      <div data-testid="account-deletion-purging" role="status">
        <h3>Irreversible live purge started</h3>
        <p>Cancellation is no longer available. Live-data deletion remains in progress.</p>
      </div>
    );
  }
  if (deletion.state === "failed") {
    return (
      <div data-testid="account-deletion-failed" role="alert">
        <h3>Live-data purge needs retry</h3>
        <p>Account remains inaccessible. Deletion is not complete.</p>
      </div>
    );
  }
  if (deletion.state === "live_purged" || deletion.state === "provider_pending") {
    return (
      <div data-testid="account-deletion-provider-pending" role="status">
        <h3>Live data purged; other obligations remain</h3>
        <p>Provider deletion: {deletion.providerState}. Backup aging remains pending.</p>
      </div>
    );
  }
  if (deletion.state === "complete") {
    return (
      <div data-testid="account-deletion-complete" role="status">
        <h3>Required live and provider deletion stages completed</h3>
        <p>
          Encrypted backup aging and applicable limited retained records follow disclosed schedules.
        </p>
      </div>
    );
  }
  return <p>Account deletion request canceled.</p>;
}

export function AccountDeletionFlow({ api }: AccountDeletionFlowProps) {
  const [deletion, setDeletion] = useState<AccountDeletionView | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"error" | "loading" | "ready">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      setDeletion(await api.status());
      setState("ready");
    } catch {
      setState("error");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestDeletion = async () => {
    if (!confirmed) return;
    setState("loading");
    try {
      setDeletion(await api.request(password));
      setPassword("");
      setState("ready");
    } catch {
      setState("error");
    }
  };

  const cancel = async () => {
    if (deletion === null) return;
    try {
      await api.cancel(deletion.revision);
      setDeletion(null);
    } catch {
      setState("error");
    }
  };

  return (
    <section aria-labelledby="account-deletion-title" data-testid="account-deletion-flow">
      <h2 id="account-deletion-title">Delete account</h2>
      {state === "loading" && <p role="status">Loading deletion status…</p>}
      {state === "error" && (
        <div role="alert">
          <p>Deletion status unavailable. No completion is assumed.</p>
          <button onClick={() => void load()} type="button">
            Retry status
          </button>
        </div>
      )}
      {state === "ready" && deletion === null && (
        <div>
          <label>
            <input
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            I understand journal access will be suspended and purge becomes irreversible after seven
            days.
          </label>
          <label>
            Confirm password
            <input
              autoComplete="current-password"
              data-testid="account-deletion-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <button
            disabled={!confirmed || password.length === 0}
            onClick={() => void requestDeletion()}
            type="button"
          >
            Start account deletion
          </button>
        </div>
      )}
      {state === "ready" && deletion !== null && (
        <>
          <DeletionState deletion={deletion} />
          {deletion.state === "grace" && (
            <button onClick={() => void cancel()} type="button">
              Cancel account deletion
            </button>
          )}
        </>
      )}
      <DeletionDisclosures />
    </section>
  );
}

export {
  DeletionState,
  type AccountDeletionFlowProps,
  type AccountDeletionPort,
  type AccountDeletionState,
  type AccountDeletionView,
};
