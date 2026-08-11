import { useCallback, useEffect, useState } from "react";

type ExportState =
  "canceled" | "deleted" | "deleting" | "expired" | "failed" | "queued" | "ready" | "running";

interface ExportJobView {
  readonly deletedAt: string | null;
  readonly expiresAt: string | null;
  readonly failureCode: string | null;
  readonly id: string;
  readonly readyAt: string | null;
  readonly requestedAt: string;
  readonly revision: string;
  readonly schemaVersion: "1.0";
  readonly state: ExportState;
}

interface ExportCenterPort {
  cancel(id: string, revision: string, password: string): Promise<ExportJobView>;
  download(id: string, password: string): Promise<Blob>;
  list(): Promise<readonly ExportJobView[]>;
  request(
    input: { readonly includeRecoverableDrafts: boolean },
    password: string,
  ): Promise<ExportJobView>;
}

interface ExportCenterProps {
  readonly api: ExportCenterPort;
}

function stateLabel(state: ExportState): string {
  switch (state) {
    case "queued":
      return "Queued";
    case "running":
      return "Building and verifying";
    case "ready":
      return "Available";
    case "failed":
      return "Export failed";
    case "canceled":
      return "Canceled";
    case "expired":
      return "Expired";
    case "deleting":
      return "Secure deletion pending";
    case "deleted":
      return "Deleted";
  }
}

export function ExportCenter({ api }: ExportCenterProps) {
  const [jobs, setJobs] = useState<readonly ExportJobView[]>([]);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"error" | "loading" | "ready">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      setJobs(await api.list());
      setState("ready");
    } catch {
      setState("error");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!jobs.some((job) => job.state === "queued" || job.state === "running")) return;
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [jobs, load]);

  const requestExport = async () => {
    setState("loading");
    try {
      const job = await api.request({ includeRecoverableDrafts: includeDrafts }, password);
      setPassword("");
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  const cancel = async (job: ExportJobView) => {
    try {
      const updated = await api.cancel(job.id, job.revision, password);
      setPassword("");
      setJobs((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      setState("error");
    }
  };

  const download = async (job: ExportJobView) => {
    try {
      const blob = await api.download(job.id, password);
      setPassword("");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `cashmemo-export-${job.requestedAt.slice(0, 10)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setState("error");
    }
  };

  return (
    <section aria-labelledby="export-center-title" data-testid="export-center">
      <h2 id="export-center-title">Export my data</h2>
      <p>
        Export schema 1.0 includes preferences, Categories, Money Spaces, active and archived Money
        Memos, lifecycle metadata, exact currencies, and occurrence time details. No currency
        conversion is performed.
      </p>
      <label>
        <input
          checked={includeDrafts}
          onChange={(event) => setIncludeDrafts(event.target.checked)}
          type="checkbox"
        />
        Include recoverable drafts, clearly marked non-authoritative
      </label>
      <label>
        Confirm password
        <input
          autoComplete="current-password"
          data-testid="export-password"
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />
      </label>
      <button
        disabled={state === "loading" || password.length === 0}
        onClick={() => void requestExport()}
        type="button"
      >
        Request export
      </button>
      {state === "loading" && <p role="status">Loading export status…</p>}
      {state === "error" && (
        <div role="alert">
          <p>Export status unavailable. Existing journal data remains unchanged.</p>
          <button onClick={() => void load()} type="button">
            Retry
          </button>
        </div>
      )}
      {state === "ready" && jobs.length === 0 && <p>No exports requested.</p>}
      <ul aria-live="polite">
        {jobs.map((job) => (
          <li data-testid={`export-job-${job.id}`} key={job.id}>
            <strong>{stateLabel(job.state)}</strong> · schema {job.schemaVersion}
            {job.expiresAt !== null && <span> · expires {job.expiresAt}</span>}
            {job.state === "ready" && (
              <button onClick={() => void download(job)} type="button">
                Download
              </button>
            )}
            {["failed", "queued", "ready", "running"].includes(job.state) && (
              <button onClick={() => void cancel(job)} type="button">
                Cancel export
              </button>
            )}
            {job.state === "failed" && (
              <p>Generation failed. Retry creates no duplicate records.</p>
            )}
            {(job.state === "expired" || job.state === "canceled") && (
              <p>Package is inaccessible and object deletion is enforced.</p>
            )}
          </li>
        ))}
      </ul>
      <p>Available packages expire within 24 hours. Downloads stay inside Cashmemo.</p>
    </section>
  );
}

export { stateLabel, type ExportCenterPort, type ExportJobView, type ExportState };
