"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCategory,
  createMemo,
  deleteCategory,
  deleteMemo,
  getCategories,
  getMe,
  getMemos,
  getSummary,
  login,
  logout,
  signup,
  updateCategory,
  updateMe,
  updateMemo,
  type CategoryInput,
  type MemoInput,
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

export function useMemos(month: string, categoryId?: string) {
  return useQuery({ queryKey: ["memos", month, categoryId ?? null], queryFn: () => getMemos(month, categoryId), placeholderData: keepPreviousData });
}

export function useSummary(month: string) {
  return useQuery({ queryKey: ["summary", month], queryFn: () => getSummary(month), placeholderData: keepPreviousData });
}

function useInvalidateMoney() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["memos"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
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
