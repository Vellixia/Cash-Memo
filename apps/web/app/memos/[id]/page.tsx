"use client";

import { useParams, useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import MemoForm from "@/components/MemoForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo_ } from "@/lib/queries";

export default function EditMemoPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { data: memo, isLoading, error } = useMemo_(params.id);

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Edit memo</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && <Skeleton className="h-64" />}
            {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Could not load memo"}</p>}
            {memo && <MemoForm memo={memo} onSaved={() => router.push("/")} />}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
