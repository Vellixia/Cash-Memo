import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import {
  currentAccountPartition,
  resetAccountSessionForTests,
  switchAccount,
} from "../src/lib/auth/session";

afterEach(() => resetAccountSessionForTests());

describe("authenticated account transitions", () => {
  it("clears prior-account server state before exposing the next identity", () => {
    const queryClient = new QueryClient();
    switchAccount({ accountId: "account-a" }, queryClient);
    queryClient.setQueryData(["owned", "account-a"], "old-visible-data");

    switchAccount({ accountId: "account-b" }, queryClient);

    expect(queryClient.getQueryData(["owned", "account-a"])).toBeUndefined();
    expect(currentAccountPartition()).toEqual({ accountId: "account-b" });
  });

  it("clears prior-account state synchronously on sign-out", () => {
    const queryClient = new QueryClient();
    switchAccount({ accountId: "account-a" }, queryClient);
    queryClient.setQueryData(["owned"], "old-visible-data");

    switchAccount(null, queryClient);

    expect(queryClient.getQueryData(["owned"])).toBeUndefined();
    expect(currentAccountPartition()).toBeNull();
  });
});
