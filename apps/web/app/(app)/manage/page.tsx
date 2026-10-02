"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Segmented } from "@/components/segmented";
import { CategoriesPanel } from "./categories";
import { SourcesPanel } from "./sources";

type Tab = "categories" | "sources";

/** Money setup: categories and sources, one tab at a time. The tab lives in `?tab=` so it can be linked. */
export default function ManagePage() {
  return (
    <Suspense>
      <Manage />
    </Suspense>
  );
}

function Manage() {
  const tab: Tab = useSearchParams().get("tab") === "sources" ? "sources" : "categories";
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-4">
        <div className="space-y-1">
          <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Manage</h1>
          <p className="text-sm text-muted-foreground">The categories and sources you pick from when you write a memo.</p>
        </div>
        <Segmented
          label="Manage section"
          className="flex w-full sm:w-72"
          value={tab}
          // Next keeps useSearchParams in sync with history.replaceState, so switching is instant.
          onChange={(t) => window.history.replaceState(null, "", `?tab=${t}`)}
          options={[
            { value: "categories", label: "Categories" },
            { value: "sources", label: "Sources" },
          ]}
        />
      </header>
      {tab === "categories" ? <CategoriesPanel /> : <SourcesPanel />}
    </div>
  );
}
