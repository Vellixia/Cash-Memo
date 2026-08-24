import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
  getPostLoginPath,
  getSafeReturnPath,
  isSafeReturnPath,
  clearSessionState,
  deletionActionsForStatus,
  getDeletionErrorDestination,
} from "../lib/auth/session";
import { credentialsSchema as formCredentialsSchema } from "../features/auth/forms";
import { credentialsSchema as sharedCredentialsSchema } from "../lib/validation/auth";

describe("auth navigation safety", () => {
  it("allows internal app return paths", () => {
    expect(isSafeReturnPath("/app/transactions")).toBe(true);
    expect(getSafeReturnPath("/app/transactions")).toBe("/app/transactions");
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

  it("routes deletion-only login access to the deletion screen", () => {
    expect(getPostLoginPath("DELETION_ONLY", "/app/transactions")).toBe("/deletion");
  });

  it("routes full login access through safe return path", () => {
    expect(getPostLoginPath("FULL", "/app/transactions")).toBe("/app/transactions");
    expect(getPostLoginPath("FULL", "//evil.example")).toBe("/app");
  });

  it("fails closed for unknown or missing login access", () => {
    expect(getPostLoginPath("UNKNOWN", "/app/transactions")).toBe("/login");
    expect(getPostLoginPath(undefined, "/app/transactions")).toBe("/login");
  });

  it("renders cancel action only for API pending_deletion status", () => {
    expect(deletionActionsForStatus("pending_deletion").canCancel).toBe(true);
    expect(deletionActionsForStatus("pending").canCancel).toBe(false);
    expect(deletionActionsForStatus("requested").canCancel).toBe(false);
    expect(deletionActionsForStatus("purging")).toEqual({ canCancel: false, signOutOnly: true });
  });

  it("fails closed to login when deletion status is unauthorized", () => {
    expect(getDeletionErrorDestination({ response: { status: 401 } })).toBe("/login");
  });

  it("uses one canonical credentials schema for auth forms", () => {
    expect(formCredentialsSchema).toBe(sharedCredentialsSchema);
  });
});
