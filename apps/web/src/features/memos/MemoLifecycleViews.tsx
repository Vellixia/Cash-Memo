import { useState, type SyntheticEvent } from "react";

export interface MemoLifecycleViewsProps {
  memos: readonly {
    id: string;
    direction: "income" | "expense";
    money: { amount: string; currency: string };
    occurredAt: string;
    lifecycleState: string;
    revision: string;
  }[];
  recentlyDeleted: readonly {
    id: string;
    direction: "income" | "expense";
    money: { amount: string; currency: string };
    deletedAt: string;
    purgeAfter: string;
    revision: string;
  }[];
  onArchive: (memoId: string, expectedRevision: string) => Promise<void>;
  onRestoreArchive: (memoId: string, expectedRevision: string) => Promise<void>;
  onDelete: (memoId: string, expectedRevision: string) => Promise<void>;
  onRestoreDelete: (memoId: string, expectedRevision: string) => Promise<void>;
  onPurge: (memoId: string, expectedRevision: string) => Promise<void>;
}

export function MemoLifecycleViews({
  memos,
  recentlyDeleted,
  onArchive,
  onRestoreArchive,
  onDelete,
  onRestoreDelete,
  onPurge,
}: MemoLifecycleViewsProps) {
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null);

  const handlePurge = (e: SyntheticEvent, memoId: string, revision: string) => {
    e.preventDefault();
    if (confirmPurgeId !== memoId) {
      setConfirmPurgeId(memoId);
      return;
    }
    setConfirmPurgeId(null);
    void onPurge(memoId, revision);
  };

  return (
    <div data-testid="memo-lifecycle-views">
      <section data-testid="active-memos">
        <h2>Money Journal</h2>
        {memos.length === 0 ? (
          <p data-testid="empty-journal">No memos yet.</p>
        ) : (
          <ul>
            {memos.map((memo) => (
              <li key={memo.id} data-testid={`memo-${memo.id}`}>
                <span>
                  {memo.direction === "expense" ? "−" : "+"} {memo.money.amount}{" "}
                  {memo.money.currency}
                </span>
                <span> {memo.occurredAt}</span>
                {memo.lifecycleState === "active" && (
                  <>
                    <button onClick={() => void onArchive(memo.id, memo.revision)}>Archive</button>
                    <button onClick={() => void onDelete(memo.id, memo.revision)}>Delete</button>
                  </>
                )}
                {memo.lifecycleState === "archived" && (
                  <>
                    <button onClick={() => void onRestoreArchive(memo.id, memo.revision)}>
                      Restore
                    </button>
                    <button onClick={() => void onDelete(memo.id, memo.revision)}>Delete</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {recentlyDeleted.length > 0 && (
        <section data-testid="recently-deleted">
          <h2>Recently Deleted</h2>
          <p>Items are permanently deleted after 30 days.</p>
          <ul>
            {recentlyDeleted.map((memo) => (
              <li key={memo.id} data-testid={`deleted-${memo.id}`}>
                <span>
                  {memo.direction === "expense" ? "−" : "+"} {memo.money.amount}{" "}
                  {memo.money.currency}
                </span>
                <span> Deleted: {memo.deletedAt}</span>
                <span> Purge after: {memo.purgeAfter}</span>
                <button onClick={() => void onRestoreDelete(memo.id, memo.revision)}>
                  Restore
                </button>
                <button
                  data-testid={`purge-${memo.id}`}
                  onClick={(e) => {
                    handlePurge(e, memo.id, memo.revision);
                  }}
                >
                  {confirmPurgeId === memo.id ? "Confirm permanent deletion" : "Permanently delete"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
