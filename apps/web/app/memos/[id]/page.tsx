"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import MemoForm from "@/components/MemoForm";
import { api, type Memo } from "@/lib/api";

export default function EditMemoPage() {
  const params = useParams<{ id: string }>();
  const [memo, setMemo] = useState<Memo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Memo>(`/memos/${params.id}`)
      .then(setMemo)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load memo"));
  }, [params.id]);

  return (
    <main className="flex flex-1 items-start justify-center p-4 pt-10">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!error && !memo && <p className="text-zinc-500">Loading...</p>}
      {memo && <MemoForm memo={memo} />}
    </main>
  );
}
