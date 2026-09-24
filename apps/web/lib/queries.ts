"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCategory,
  createMemo,
  deleteCategory,
  deleteMemo,
  getCategories,
  getMe,
  getMemo,
  getMemos,
  getSummary,
  login,
  logout,
  signup,
  updateCategory,
  updateMemo,
  type Direction,
  type MemoInput,
} from "@/lib/api";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
}

export function useLogin() {
  return useMutation({ mutationFn: ({ email, password }: { email: string; password: string }) => login(email, password) });
}

export function useSignup() {
  return useMutation({ mutationFn: ({ email, password }: { email: string; password: string }) => signup(email, password) });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => qc.clear(),
  });
}

export function useMemos(month: string, categoryId?: string) {
  return useQuery({ queryKey: ["memos", month, categoryId ?? null], queryFn: () => getMemos(month, categoryId) });
}

export function useMemo_(id: string | undefined) {
  return useQuery({ queryKey: ["memo", id], queryFn: () => getMemo(id as string), enabled: !!id });
}

export function useSummary(month: string) {
  return useQuery({ queryKey: ["summary", month], queryFn: () => getSummary(month) });
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
  return useMutation({
    mutationFn: (input: MemoInput) => createMemo(input),
    onSuccess: invalidate,
  });
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
  return useMutation({
    mutationFn: (id: string) => deleteMemo(id),
    onSuccess: invalidate,
  });
}

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: getCategories });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; direction: Direction }) => createCategory(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateCategory(id, name),
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
