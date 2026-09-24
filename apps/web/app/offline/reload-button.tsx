"use client";

import { Button } from "@/components/ui/button";

export function ReloadButton() {
  return <Button onClick={() => window.location.reload()}>Try again</Button>;
}
