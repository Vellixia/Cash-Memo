import { describe, expect, it } from "vitest";

import {
  DeterministicFaultProxy,
  FAULT_PROXY_SCENARIOS,
  FaultProxyError,
} from "../src/harness/fault-proxy-scenarios.js";

describe("deterministic fault proxy scenarios", () => {
  it("enumerates all nine reusable controlled faults", () => {
    expect(FAULT_PROXY_SCENARIOS).toHaveLength(9);
  });

  it.each(["timeout", "connection_reset", "rate_limit"] as const)(
    "%s fails before commit and permits retry",
    async (scenario) => {
      let commits = 0;
      const proxy = new DeterministicFaultProxy();
      await expect(
        proxy.execute({
          commit: () => {
            commits += 1;
            return Promise.resolve("result");
          },
          identity: "request-1",
          operation: "memo.confirm",
          scenario,
        }),
      ).rejects.toMatchObject({ commitState: "not_committed", retryable: true });
      expect(commits).toBe(0);
    },
  );

  it("distinguishes a committed result whose response is lost", async () => {
    let commits = 0;
    const proxy = new DeterministicFaultProxy();
    await expect(
      proxy.execute({
        commit: () => Promise.resolve(++commits),
        identity: "request-2",
        operation: "memo.confirm",
        scenario: "lost_response",
      }),
    ).rejects.toEqual(new FaultProxyError("lost_response", "committed", true));
    expect(commits).toBe(1);
  });

  it.each(["invalid_body", "partial_body"] as const)(
    "%s is terminal and never reaches commit",
    async (scenario) => {
      const proxy = new DeterministicFaultProxy();
      await expect(
        proxy.execute({
          commit: () => Promise.resolve("unreachable"),
          identity: "request-3",
          operation: "provider.response",
          scenario,
        }),
      ).rejects.toMatchObject({ commitState: "not_committed", retryable: false });
    },
  );

  it("delays only after the operation completes", async () => {
    const proxy = new DeterministicFaultProxy();
    await expect(
      proxy.execute({
        commit: () => Promise.resolve("committed-result"),
        identity: "request-4",
        operation: "memo.confirm",
        scenario: "delayed_response",
      }),
    ).resolves.toBe("committed-result");
    expect(proxy.metadata[0]).toMatchObject({ commitState: "committed" });
  });

  it("marks connection kill outcome unknown without fabricating success", async () => {
    const proxy = new DeterministicFaultProxy();
    await expect(
      proxy.execute({
        commit: () => Promise.resolve("unreachable"),
        identity: "request-5",
        operation: "database.commit",
        scenario: "connection_kill",
      }),
    ).rejects.toMatchObject({ commitState: "unknown" });
  });

  it("drives duplicate delivery with one stable identity", async () => {
    const identities = new Set<string>();
    const proxy = new DeterministicFaultProxy();
    await proxy.execute({
      commit: () => {
        identities.add("request-6");
        return Promise.resolve(identities.size);
      },
      identity: "request-6",
      operation: "worker.delivery",
      scenario: "duplicate_delivery",
    });
    expect(identities.size).toBe(1);
  });

  it("records metadata only, with no payload capture surface", async () => {
    const proxy = new DeterministicFaultProxy();
    await expect(
      proxy.execute({
        commit: () => Promise.resolve("private candidate"),
        identity: "opaque-fixture-id",
        operation: "provider.response",
        scenario: "timeout",
      }),
    ).rejects.toBeInstanceOf(FaultProxyError);
    expect(JSON.stringify(proxy.metadata)).not.toContain("private candidate");
    const metadata = proxy.metadata[0];
    expect(metadata).toBeDefined();
    if (metadata === undefined) throw new Error("FAULT_METADATA_MISSING");
    expect(Object.keys(metadata)).toEqual(["attempt", "commitState", "faultId", "operation"]);
  });
});
