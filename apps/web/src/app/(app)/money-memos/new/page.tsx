"use client";

import { ApiProblemError } from "@/lib/api/client";
import { useAccountPartition } from "@/lib/auth/session";
import type { CurrencyRegistry, Label } from "@/features/money-memos/api";
import {
  useActiveLabels,
  useCreateMoneyMemo,
  useCurrencies,
} from "@/features/money-memos/api";
import { MoneyMemoForm } from "@/features/money-memos/components/money-memo-form";
import { useComposeSession } from "@/features/money-memos/use-compose-session";

const fallbackCategories: Label[] = [
  safeLabel("66ff6d25-01b0-4442-a9fe-0c4fef1f0605", "category", "General"),
];
const fallbackSpaces: Label[] = [
  safeLabel("9074bd6a-6959-463a-8a04-88a537d12d57", "money_space", "Personal"),
];

export default function NewMoneyMemoPage() {
  const accountId =
    useAccountPartition()?.accountId ??
    (process.env.NODE_ENV === "development"
      ? "local-development-account"
      : null);
  const compose = useComposeSession(accountId);
  const currencies = useCurrencies();
  const categories = useActiveLabels("category");
  const spaces = useActiveLabels("money_space");
  const creation = useCreateMoneyMemo({
    onConfirmed: compose.complete,
    onRetainDraft: compose.retainFailure,
  });

  if (accountId === null) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p role="alert">Authenticated session required.</p>
      </main>
    );
  }
  if (creation.isSuccess && compose.draft === null) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-3xl font-semibold">Money Memo saved</h1>
        <p>Your confirmed memo is ready.</p>
      </main>
    );
  }
  if (!compose.ready || compose.draft === null) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p role="status">Preparing a private local draft…</p>
      </main>
    );
  }
  const allowDevelopmentFixtures = process.env.NODE_ENV === "development";
  const currencyItems: CurrencyRegistry["currencies"] =
    currencies.data?.currencies ??
    (allowDevelopmentFixtures ? [{ code: "USD", minorUnitScale: 2 }] : []);
  const categoryItems =
    categories.data?.items ??
    (allowDevelopmentFixtures ? fallbackCategories : []);
  const spaceItems =
    spaces.data?.items ?? (allowDevelopmentFixtures ? fallbackSpaces : []);
  if (
    !allowDevelopmentFixtures &&
    (currencies.isPending || categories.isPending || spaces.isPending)
  ) {
    return <ReferenceState message="Loading reference data…" />;
  }
  if (
    !allowDevelopmentFixtures &&
    (currencies.isError || categories.isError || spaces.isError)
  ) {
    return (
      <ReferenceState message="Reference data is temporarily unavailable. Your local draft is preserved." />
    );
  }
  if (
    !allowDevelopmentFixtures &&
    (currencyItems.length === 0 ||
      categoryItems.length === 0 ||
      spaceItems.length === 0)
  ) {
    return (
      <ReferenceState message="Required reference data is unavailable. Your local draft is preserved." />
    );
  }
  const serviceMessage = safeServiceMessage(
    creation.error,
    currencies.isError || categories.isError || spaces.isError,
  );
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-3xl font-semibold">Create Money Memo</h1>
      <MoneyMemoForm
        creationId={compose.draft.creationId}
        initialPayload={compose.draft.formPayload}
        currencies={currencyItems}
        categories={categoryItems}
        moneySpaces={spaceItems}
        onAutosave={compose.autosave}
        onCreate={async (request) =>
          creation.mutateAsync(request).then(() => undefined)
        }
        {...(serviceMessage === undefined ? {} : { serviceMessage })}
      />
    </main>
  );
}

function ReferenceState({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-3xl font-semibold">Create Money Memo</h1>
      <p role="status">{message}</p>
    </main>
  );
}

function safeLabel(
  id: string,
  kind: "category" | "money_space",
  name: string,
): Label {
  return {
    id,
    kind,
    name,
    state: "active",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000000Z",
    updatedAt: "2026-01-01T00:00:00.000000Z",
  };
}

function safeServiceMessage(
  error: Error | null,
  referencesFailed: boolean,
): string | undefined {
  if (error instanceof ApiProblemError) return error.problem.message;
  if (error !== null)
    return "Money Memo was not saved. Your local draft is preserved.";
  if (referencesFailed)
    return "Reference data is temporarily unavailable. Your local draft is preserved.";
  return undefined;
}
