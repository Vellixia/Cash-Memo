import { useState, type SyntheticEvent } from "react";

export interface MoneyMemoEditorProps {
  memo: {
    id: string;
    direction: "income" | "expense";
    money: { amount: string; currency: string };
    occurrence: { occurredAt: string; occurredTimezone: string };
    revision: string;
    lifecycleState: string;
    note: string | null;
  };
  onEdit: (input: { expectedRevision: string; note: string | null }) => Promise<void>;
  onArchive: (expectedRevision: string) => Promise<void>;
  onRestoreArchive: (expectedRevision: string) => Promise<void>;
  onDelete: (expectedRevision: string) => Promise<void>;
  onRestoreDelete: (expectedRevision: string) => Promise<void>;
  onPurge: (expectedRevision: string) => Promise<void>;
}

export function MoneyMemoEditor({
  memo,
  onEdit,
  onArchive,
  onRestoreArchive,
  onDelete,
  onRestoreDelete,
  onPurge,
}: MoneyMemoEditorProps) {
  const [note, setNote] = useState(memo.note ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const handleEdit = (e: SyntheticEvent) => {
    e.preventDefault();
    setError(null);
    setConflict(false);
    void onEdit({ expectedRevision: memo.revision, note: note || null }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "EDIT_FAILED";
      if (msg === "REVISION_CONFLICT") {
        setConflict(true);
      } else {
        setError(msg);
      }
    });
  };

  return (
    <div data-testid="memo-editor">
      <div data-testid="memo-detail">
        <p>Direction: {memo.direction}</p>
        <p>
          Amount: {memo.money.amount} {memo.money.currency}
        </p>
        <p>Date: {memo.occurrence.occurredAt}</p>
        <p>Timezone: {memo.occurrence.occurredTimezone}</p>
        <p>Revision: {memo.revision}</p>
        <p>Lifecycle: {memo.lifecycleState}</p>
      </div>

      {editing && (
        <form data-testid="memo-edit-form" onSubmit={handleEdit}>
          <label htmlFor="edit-note">Note</label>
          <textarea
            id="edit-note"
            data-testid="edit-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
          />
          <button type="submit">Save</button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}

      {conflict && (
        <div data-testid="revision-conflict">
          <p>
            This memo was modified by another session. Your changes were not lost — please review
            the latest version.
          </p>
        </div>
      )}

      {error && <div data-testid="memo-edit-error">{error}</div>}

      {!editing && memo.lifecycleState === "active" && (
        <>
          <button data-testid="edit-button" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button data-testid="archive-button" onClick={() => void onArchive(memo.revision)}>
            Archive
          </button>
          <button data-testid="delete-button" onClick={() => void onDelete(memo.revision)}>
            Delete
          </button>
        </>
      )}

      {!editing && memo.lifecycleState === "archived" && (
        <>
          <button
            data-testid="restore-archive-button"
            onClick={() => void onRestoreArchive(memo.revision)}
          >
            Restore to active
          </button>
          <button data-testid="delete-button" onClick={() => void onDelete(memo.revision)}>
            Delete
          </button>
        </>
      )}

      {!editing && memo.lifecycleState === "recently_deleted" && (
        <>
          <button
            data-testid="restore-deleted-button"
            onClick={() => void onRestoreDelete(memo.revision)}
          >
            Restore
          </button>
          <button data-testid="purge-button" onClick={() => void onPurge(memo.revision)}>
            Permanently delete
          </button>
        </>
      )}
    </div>
  );
}
