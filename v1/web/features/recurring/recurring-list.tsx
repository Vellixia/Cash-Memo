"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RecurringTransaction } from "../../generated/api/model/recurringTransaction";
import {
  getListRecurringTransactionsQueryKey,
  useDeleteRecurringTransaction,
  useListRecurringTransactions,
  usePauseRecurringTransaction,
  useResumeRecurringTransaction,
} from "../../generated/api";
import { Amount } from "../../components/money/amount";
import { Button } from "../../components/ui/button";
import { RecurringForm } from "./recurring-form";

export function RecurringList() {
  const query = useListRecurringTransactions({ query: { retry: false } });
  const pause = usePauseRecurringTransaction();
  const resume = useResumeRecurringTransaction();
  const remove = useDeleteRecurringTransaction();
  const client = useQueryClient();
  const [editing, setEditing] = useState<RecurringTransaction>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();

  async function refresh(message: string) {
    await client.invalidateQueries({ queryKey: getListRecurringTransactionsQueryKey() });
    setStatus({ kind: "success", text: message });
  }
  async function toggle(item: RecurringTransaction) {
    setStatus(undefined);
    try {
      if (item.status === "paused") await resume.mutateAsync({ id: item.id });
      else await pause.mutateAsync({ id: item.id });
      await refresh(
        item.status === "paused" ? "Recurring rule resumed." : "Recurring rule paused.",
      );
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not update recurring rule.",
      });
    }
  }
  async function deleteItem(id: string) {
    setStatus(undefined);
    try {
      await remove.mutateAsync({ id });
      await refresh("Recurring rule deleted.");
      setDeleting(undefined);
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not delete recurring rule.",
      });
    }
  }

  if (query.isPending) return <p role="status">Loading recurring rules…</p>;
  if (query.isError)
    return (
      <div className="error-panel" role="alert">
        <p>Could not load recurring rules.</p>
        <Button type="button" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  const items = query.data.data;
  return (
    <section className="management-page">
      <header className="page-heading">
        <div>
          <p className="muted">Scheduled instructions</p>
          <h1>Recurring transactions</h1>
        </div>
        <Button
          type="button"
          onClick={() => {
            setCreating(true);
            setEditing(undefined);
          }}
        >
          New recurring rule
        </Button>
      </header>
      <p className="notice">
        An upcoming recurring rule does not affect totals or history until Cashmemo generates a
        transaction on its due date.
      </p>
      {creating ? (
        <RecurringForm
          onSaved={() => {
            setCreating(false);
          }}
          onCancel={() => {
            setCreating(false);
          }}
        />
      ) : null}
      {editing ? (
        <RecurringForm
          key={editing.id}
          recurring={editing}
          onSaved={() => {
            setEditing(undefined);
          }}
          onCancel={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
      {status ? (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={status.kind === "error" ? "field-error" : "success"}
        >
          {status.text}
        </p>
      ) : null}
      {items.length === 0 ? (
        <div className="empty-state">
          <h2>No recurring rules</h2>
          <p>Create a daily, weekly, monthly, or yearly instruction.</p>
        </div>
      ) : (
        <div className="card-list">
          {items.map((item) => {
            const title = item.note?.trim() ?? `${item.frequency} ${item.direction}`;
            return (
              <article className="management-card" key={item.id}>
                <div>
                  <h2>{title}</h2>
                  <p>
                    <span className="status-label">
                      {item.status === "paused" ? "Paused" : "Active"}
                    </span>{" "}
                    · {item.frequency}
                  </p>
                  <p>
                    <Amount currency={item.currency} value={item.amount} /> · {item.direction}
                  </p>
                  <p className="muted">
                    Next due:{" "}
                    {new Date(`${item.next_due_date}T00:00:00Z`).toLocaleDateString("en-US", {
                      dateStyle: "long",
                      timeZone: "UTC",
                    })}
                  </p>
                </div>
                <div className="card-actions">
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      setEditing(item);
                      setCreating(false);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pause.isPending || resume.isPending}
                    onClick={() => void toggle(item)}
                  >
                    {item.status === "paused" ? "Resume" : "Pause"}
                  </Button>
                  {deleting === item.id ? (
                    <div className="confirm-box" role="alert">
                      <p>Delete this recurring rule?</p>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => void deleteItem(item.id)}
                        disabled={remove.isPending}
                      >
                        Confirm delete
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() => {
                          setDeleting(undefined);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => {
                        setDeleting(item.id);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
