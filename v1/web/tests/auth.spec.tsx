import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
  getSafeReturnPath,
  isSafeReturnPath,
  clearSessionState,
} from "../lib/auth/session";

describe("auth navigation safety", () => {
  it("allows internal app return paths", () => {
    expect(isSafeReturnPath("/app/history")).toBe(true);
    expect(getSafeReturnPath("/app/history")).toBe("/app/history");
  });

  it("rejects external, malformed, and destructive return paths", () => {
    expect(isSafeReturnPath("//evil.example")).toBe(false);
    expect(isSafeReturnPath("https://evil.example")).toBe(false);
    expect(isSafeReturnPath("/app/settings/delete-account")).toBe(false);
    expect(getSafeReturnPath("//evil.example")).toBe("/app");
  });

  it("clears in-memory server state on session end", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["private-memo"], { amount: "85000" });
    clearSessionState(queryClient);
    expect(queryClient.getQueryData(["private-memo"])).toBeUndefined();
  });
});
