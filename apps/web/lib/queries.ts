"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveSource,
  changeEmail,
  changePassword,
  completePasswordReset,
  confirmAttachment,
  confirmEmail,
  createCategory,
  createMemo,
  createPlan,
  createSource,
  deleteAccount,
  deleteAttachment,
  deleteCategory,
  deleteMemo,
  deletePlan,
  getAttachmentUrl,
  getCategories,
  getJob,
  getMe,
  getMemos,
  getPlans,
  getSources,
  getSummary,
  getTrend,
  utcOffsetMinutes,
  login,
  logout,
  requestPasswordReset,
  restoreMemo,
  searchCursor,
  searchMemos,
  SEARCH_PAGE_SIZE,
  signup,
  startAttachmentUpload,
  startCommit,
  startExport,
  startImportUpload,
  startValidate,
  updateCategory,
  updateMe,
  updateMemo,
  updateSource,
  type AttachmentContentType,
  type CategoryInput,
  type CommitResult,
  type ExportResult,
  type Job,
  type Mapping,
  type MemoInput,
  type PlanInput,
  type SourceInput,
  type ValidateResult,
} from "@/lib/api";
import {
  createBudget,
  createRecurring,
  deleteBudget,
  deleteRecurring,
  getBudgets,
  getRecurring,
  getUpcoming,
  updateBudget,
  updateRecurring,
  type RecurringInput,
} from "@/lib/api";
import { guessCurrency } from "@/lib/money";

type Credentials = { email: string; password: string };

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
}

/** Login/signup start a fresh session: drop anything cached from a previous user. */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ email, password }: Credentials) => login(email, password), onSuccess: () => qc.clear() });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    // A first guess from the browser's region; changeable on the Account page.
    mutationFn: ({ email, password }: Credentials) => signup(email, password, guessCurrency(navigator.language)),
    onSuccess: () => qc.clear(),
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: updateMe, onSuccess: (user) => qc.setQueryData(["me"], user) });
}

export function useLogout() {
  return useMutation({ mutationFn: logout });
}

export function useMemos(month: string, categoryId?: string, sourceId?: string) {
  return useQuery({
    queryKey: ["memos", month, categoryId ?? null, sourceId ?? null],
    queryFn: () => getMemos(month, categoryId, sourceId),
    placeholderData: keepPreviousData,
  });
}

export function useSummary(month: string) {
  return useQuery({ queryKey: ["summary", month], queryFn: () => getSummary(month), placeholderData: keepPreviousData });
}

function useInvalidateMoney() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["memos"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
    // Memos move money between sources, so their balances may have changed too.
    qc.invalidateQueries({ queryKey: ["sources"] });
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["reports-trend"] });
  };
}

export function useCreateMemo() {
  const invalidate = useInvalidateMoney();
  return useMutation({ mutationFn: (input: MemoInput) => createMemo(input), onSuccess: invalidate });
}

export function useUpdateMemo() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<MemoInput> }) => updateMemo(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteMemo() {
  const invalidate = useInvalidateMoney();
  return useMutation({ mutationFn: (id: string) => deleteMemo(id), onSuccess: invalidate });
}

/** Undoes a soft delete (see `useDeleteMemo`). */
export function useRestoreMemo() {
  const invalidate = useInvalidateMoney();
  return useMutation({ mutationFn: (id: string) => restoreMemo(id), onSuccess: invalidate });
}

/** Full-text-ish search across all months. Disabled until `q` (trimmed) is at least 2 characters. */
export function useSearchMemos(q: string) {
  const query = q.trim();
  return useInfiniteQuery({
    queryKey: ["search", query],
    queryFn: ({ pageParam }: { pageParam?: string }) => searchMemos(query, pageParam),
    enabled: query.length >= 2,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.length === SEARCH_PAGE_SIZE ? searchCursor(lastPage[lastPage.length - 1]) : undefined),
  });
}

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: getCategories });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CategoryInput) => createCategory(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export const STARTER_CATEGORIES: CategoryInput[] = [
  { name: "Food", emoji: "🍜", direction: "expense" },
  { name: "Transport", emoji: "🚌", direction: "expense" },
  { name: "Shopping", emoji: "🛍️", direction: "expense" },
  { name: "Bills", emoji: "🧾", direction: "expense" },
  { name: "Fun", emoji: "🎉", direction: "expense" },
  { name: "Salary", emoji: "💼", direction: "income" },
  { name: "Other income", emoji: "💰", direction: "income" },
];

/** Sequential so the categories keep a stable creation order. */
export function useAddStarterSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      for (const c of STARTER_CATEGORIES) await createCategory(c);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; emoji?: string | null } }) => updateCategory(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["memos"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["reports-trend"] });
    },
  });
}

export function useSources() {
  return useQuery({ queryKey: ["sources"], queryFn: getSources });
}

export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SourceInput) => createSource(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SourceInput> & { archived?: boolean } }) => updateSource(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

/** Archives a source (restoring is `useUpdateSource` with `{ archived: false }`). */
export function useArchiveSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveSource(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sources"] });
      qc.invalidateQueries({ queryKey: ["memos"] });
    },
  });
}

// --- installment plans -------------------------------------------------------

export function usePlans() {
  return useQuery({ queryKey: ["plans"], queryFn: getPlans });
}

/** A plan's memos affect balances, summaries and the ledger, on top of the plan list itself. */
function useInvalidatePlans() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["plans"] });
    qc.invalidateQueries({ queryKey: ["memos"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["sources"] });
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["reports-trend"] });
  };
}

export function useCreatePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({ mutationFn: (input: PlanInput) => createPlan(input), onSuccess: invalidate });
}

export function useDeletePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({ mutationFn: (id: string) => deletePlan(id), onSuccess: invalidate });
}

// --- account: password reset, change password/email, delete ---------------

export function useRequestPasswordReset() {
  return useMutation({ mutationFn: (email: string) => requestPasswordReset(email) });
}

export function useCompletePasswordReset() {
  return useMutation({ mutationFn: ({ token, password }: { token: string; password: string }) => completePasswordReset(token, password) });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) => changePassword(current, next),
  });
}

export function useChangeEmail() {
  return useMutation({
    mutationFn: ({ current_password, new_email }: { current_password: string; new_email: string }) => changeEmail(current_password, new_email),
  });
}

export function useConfirmEmail() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (token: string) => confirmEmail(token), onSuccess: (user) => qc.setQueryData(["me"], user) });
}

export function useDeleteAccount() {
  return useMutation({ mutationFn: (password: string) => deleteAccount(password) });
}

// --- data: export/import ----------------------------------------------------

export function useStartExport() {
  return useMutation({ mutationFn: startExport });
}

export function useStartImportUpload() {
  return useMutation({ mutationFn: startImportUpload });
}

export function useStartValidate() {
  return useMutation({ mutationFn: ({ importId, mapping }: { importId: string; mapping: Mapping }) => startValidate(importId, mapping) });
}

export function useStartCommit() {
  return useMutation({ mutationFn: (validateJobId: string) => startCommit(validateJobId) });
}

/** Polls a job every 1.5s until it's done or failed. `enabled: false` to pause (e.g. no job yet). */
export function useJob<R = ExportResult | ValidateResult | CommitResult | undefined>(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => getJob<R>(id!),
    enabled: !!id && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "failed" ? false : 1500;
    },
  });
}

/** A finished import commit touches memos, summaries, categories and sources. */
export function useInvalidateAfterImport() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["memos"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["sources"] });
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["reports-trend"] });
  };
}

export type { CommitResult, ExportResult, Job, Mapping, ValidateResult };

// --- memo attachments -------------------------------------------------------

export function useStartAttachmentUpload() {
  return useMutation({
    mutationFn: ({ memoId, contentType }: { memoId: string; contentType: AttachmentContentType }) =>
      startAttachmentUpload(memoId, contentType),
  });
}

export function useConfirmAttachment() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ memoId, key }: { memoId: string; key: string }) => confirmAttachment(memoId, key),
    onSuccess: invalidate,
  });
}

/** The attachment's presigned view URL; `enabled` so it's only fetched once there's one to show. */
export function useAttachmentUrl(memoId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["attachment", memoId],
    queryFn: () => getAttachmentUrl(memoId!),
    enabled: !!memoId && enabled,
  });
}

export function useDeleteAttachment() {
  const invalidate = useInvalidateMoney();
  return useMutation({ mutationFn: (memoId: string) => deleteAttachment(memoId), onSuccess: invalidate });
}

// --- reports -----------------------------------------------------------------

export function useTrend(months: 3 | 6 | 12) {
  const offset = utcOffsetMinutes();
  return useQuery({
    queryKey: ["reports-trend", months, offset],
    queryFn: () => getTrend(months, offset),
    // Recurring jobs can insert memos without a browser mutation; refresh an open report too.
    refetchInterval: 60_000,
  });
}


// --- recurring memos & budgets ----------------------------------------------

export function useRecurring() {
  return useQuery({ queryKey: ["recurring"], queryFn: getRecurring });
}

export function useUpcoming(month: string) {
  return useQuery({ queryKey: ["upcoming", month], queryFn: () => getUpcoming(month), placeholderData: keepPreviousData });
}

/** A rule write may create memos at once (anything already due), so money queries refresh too. */
function useInvalidateRecurring() {
  const qc = useQueryClient();
  const money = useInvalidateMoney();
  return () => {
    money();
    qc.invalidateQueries({ queryKey: ["recurring"] });
    qc.invalidateQueries({ queryKey: ["upcoming"] });
  };
}

export function useCreateRecurring() {
  const invalidate = useInvalidateRecurring();
  return useMutation({ mutationFn: (input: RecurringInput) => createRecurring(input), onSuccess: invalidate });
}

export function useUpdateRecurring() {
  const invalidate = useInvalidateRecurring();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: RecurringInput }) => updateRecurring(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteRecurring() {
  const invalidate = useInvalidateRecurring();
  return useMutation({ mutationFn: (id: string) => deleteRecurring(id), onSuccess: invalidate });
}

export function useBudgets(month: string) {
  return useQuery({ queryKey: ["budgets", month], queryFn: () => getBudgets(month), placeholderData: keepPreviousData });
}

export function useSaveBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { id?: string; category_id: string; currency: string; limit_minor: number }) =>
      b.id ? updateBudget(b.id, b.limit_minor) : createBudget(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgets"] }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => deleteBudget(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["budgets"] }) });
}
