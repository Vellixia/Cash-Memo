"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useCreateCategory, useUpdateCategory } from "../../generated/api";
import type { CategoryContract } from "../../generated/api/model/categoryContract";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";
import { categorySchema, type CategoryFormValues } from "../../lib/validation/category";

function errorText(error: unknown): string {
  const value = error as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
}

export function CategoryForm({
  category,
  onSuccess,
}: {
  category?: CategoryContract;
  onSuccess?: (category: CategoryContract) => void;
}) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    mode: "onChange",
    defaultValues: {
      name: category?.name ?? "",
      kind: category ? (category.kind as "income" | "expense") : "expense",
    },
  });

  async function submit(values: CategoryFormValues) {
    setStatus(undefined);
    try {
      if (category) {
        const response = await update.mutateAsync({
          categoryId: category.id,
          data: { name: values.name },
        });
        setStatus({ kind: "success", text: "Category renamed." });
        onSuccess?.(response.data);
      } else {
        const response = await create.mutateAsync({ data: values });
        setStatus({ kind: "success", text: "Category created." });
        onSuccess?.(response.data);
        form.reset({ name: "", kind: values.kind });
      }
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  const pending = create.isPending || update.isPending;
  return (
    <form
      className="dialog category-form"
      onSubmit={(event) => {
        void form.handleSubmit(submit)(event);
      }}
      noValidate
    >
      <h2>{category ? "Rename category" : "Create category"}</h2>
      {category ? (
        <p className="muted">Renaming updates how this label appears across history.</p>
      ) : (
        <p className="muted">Income and expense categories stay separate.</p>
      )}
      <FormField
        label="Category name"
        htmlFor="category-name"
        error={form.formState.errors.name?.message}
      >
        <Input id="category-name" autoComplete="off" {...form.register("name")} />
      </FormField>
      <FormField label="Kind" htmlFor="category-kind" error={form.formState.errors.kind?.message}>
        <select
          id="category-kind"
          className="input"
          disabled={Boolean(category)}
          {...form.register("kind")}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </FormField>
      {category ? (
        <p className="muted">Kind cannot be changed. Create another category if needed.</p>
      ) : null}
      {status ? (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={status.kind === "error" ? "field-error" : "success"}
        >
          {status.text}
        </p>
      ) : null}
      <Button type="submit" disabled={!form.formState.isValid || pending}>
        {pending ? "Saving…" : category ? "Save name" : "Create category"}
      </Button>
    </form>
  );
}
