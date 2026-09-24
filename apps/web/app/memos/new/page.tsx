"use client";

import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import MemoForm from "@/components/MemoForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewMemoPage() {
  const router = useRouter();
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>New memo</CardTitle>
          </CardHeader>
          <CardContent>
            <MemoForm onSaved={() => router.push("/")} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
