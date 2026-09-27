"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveSource,
  changeEmail,
  changePassword,
  completePasswordReset,
  confirmEmail,
  createCategory,
  createMemo,
  createSource,
  deleteAccount,
  deleteCategory,
  deleteMemo,
  getCategories,
  getJob,
  getMe,
  getMemos,
  getSources,
  getSummary,
  login,
  logout,
  requestPasswordReset,
  signup,
  startCommit,
  startExport,
  startImportUpload,
  startValidate,
  updateCategory,
  updateMe,
  updateMemo,
  updateSource,
  type CategoryInput,
  type CommitResult,
  type ExportResult,
  type Job,
  type Mapping,
  type MemoInput,
  type SourceInput,
  type ValidateResult,
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
  };
}

export type { CommitResult, ExportResult, Job, Mapping, ValidateResult };
