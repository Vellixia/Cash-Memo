"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRequestAccountDeletion } from "../../generated/api";
import { clearPrivateQueryState } from "../../lib/query-client";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";

export function AccountDeletion() {
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  const [requestError, setRequestError] = useState<string>();
  const [deletionDueAt, setDeletionDueAt] = useState<string>();
  const requestDeletion = useRequestAccountDeletion();
  const client = useQueryClient();
  const router = useRouter();

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(undefined);
    setRequestError(undefined);
    if (!password) {
      setPasswordError("Enter your current password.");
      return;
    }
    try {
      const response = await requestDeletion.mutateAsync({ data: { password } });
      setDeletionDueAt(response.data.deletion_due_at ?? undefined);
      await clearPrivateQueryState(client);
      router.replace("/deletion");
    } catch (value) {
      setRequestError(
        value instanceof Error
          ? value.message
          : "Could not schedule account deletion. A recent password is required.",
      );
    }
  }

  return (
    <form className="dialog deletion-settings" onSubmit={(event) => void submit(event)} noValidate>
      <h2>Delete account</h2>
      <p>
        Scheduling deletion immediately changes this account to deletion-only access. Financial
        screens become unavailable.
      </p>
      <p>You have a 7-day grace period to cancel from the account deletion screen.</p>
      <p>Live account data is permanently deleted after the grace period.</p>
      <p>
        After permanent deletion, encrypted backups may retain deleted data after the grace period
        according to the backup retention schedule.
      </p>
      {deletionDueAt ? (
        <p role="status">
          Deletion scheduled for {new Date(deletionDueAt).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })}.
        </p>
      ) : null}
      <p>
        Resetting your password remains available while signed out and does not cancel deletion.
      </p>
      <FormField label="Current password" htmlFor="deletion-password" error={passwordError}>
        <Input
          id="deletion-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setPasswordError(undefined);
          }}
        />
      </FormField>
      <Button type="submit" variant="danger" disabled={requestDeletion.isPending}>
        Schedule account deletion
      </Button>
      {requestError ? (
        <p role="alert" className="field-error">
          {requestError}
        </p>
      ) : null}
    </form>
  );
}
