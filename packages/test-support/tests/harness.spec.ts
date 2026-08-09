import { describe, expect, it } from "vitest";

import {
  FaultInjectingProxy,
  InjectedFaultError,
  LostResponseError,
  ProviderCaptureHarness,
  TestHarnessInvariantError,
  deliverDuplicates,
  verifyTwoAccountIsolation,
} from "../src/harness/index.js";

const fixture = {
  otherAccountId: "018f0f50-b524-7c5f-8e89-0242ac120003",
  ownerAccountId: "018f0f50-b524-7c5f-8e89-0242ac120002",
  resourceId: "018f0f50-b524-7c5f-8e89-0242ac120004",
} as const;

describe("failure, delivery, capture, and isolation harnesses", () => {
  it("verifies owner success and second-account denial for every operation", async () => {
    await expect(
      verifyTwoAccountIsolation(fixture, [
        {
          execute: async (actorAccountId) => {
            await Promise.resolve();
            return actorAccountId === fixture.ownerAccountId
              ? { outcome: "allowed" as const }
              : { code: "NOT_FOUND" as const, outcome: "denied" as const };
          },
          name: "memo.read",
        },
        {
          execute: async (actorAccountId) => {
            await Promise.resolve();
            return actorAccountId === fixture.ownerAccountId
              ? { outcome: "allowed" as const }
              : { code: "FORBIDDEN" as const, outcome: "denied" as const };
          },
          name: "memo.update",
        },
      ]),
    ).resolves.toEqual([
      { operation: "memo.read", otherOutcome: "denied", ownerOutcome: "allowed" },
      { operation: "memo.update", otherOutcome: "denied", ownerOutcome: "allowed" },
    ]);
  });

  it("fails isolation verification when another account gets access", async () => {
    await expect(
      verifyTwoAccountIsolation(fixture, [
        {
          execute: async () => {
            await Promise.resolve();
            return { outcome: "allowed" };
          },
          name: "memo.read",
        },
      ]),
    ).rejects.toBeInstanceOf(TestHarnessInvariantError);
  });

  it("injects before-call failure and post-commit response loss distinctly", async () => {
    let commits = 0;
    const proxy = new FaultInjectingProxy(
      async (value: number) => {
        await Promise.resolve();
        commits += 1;
        return value * 2;
      },
      [
        { code: "DATABASE_UNAVAILABLE", kind: "fail_before" },
        { code: "RESPONSE_CONNECTION_LOST", kind: "lose_response" },
        { kind: "pass" },
      ],
    );

    await expect(proxy.invoke(2)).rejects.toBeInstanceOf(InjectedFaultError);
    expect(commits).toBe(0);
    await expect(proxy.invoke(2)).rejects.toBeInstanceOf(LostResponseError);
    expect(commits).toBe(1);
    await expect(proxy.invoke(2)).resolves.toBe(4);
    expect(commits).toBe(2);
    expect(proxy.calls).toEqual([
      { action: "fail_before", callNumber: 1, targetCompleted: false },
      { action: "lose_response", callNumber: 2, targetCompleted: true },
      { action: "pass", callNumber: 3, targetCompleted: true },
    ]);
  });

  it("delivers exact sequential or concurrent duplicates with one request identity", async () => {
    const request = { idempotencyKey: fixture.resourceId };
    const concurrent = await deliverDuplicates({
      deliveries: 4,
      handler: async (deliveredRequest, deliveryNumber) => {
        await Promise.resolve();
        expect(deliveredRequest).toBe(request);
        return deliveryNumber;
      },
      mode: "concurrent",
      request,
    });
    expect(concurrent).toEqual([1, 2, 3, 4]);
    await expect(
      deliverDuplicates({
        deliveries: 1,
        handler: async () => {
          await Promise.resolve();
          return 1;
        },
        mode: "sequential",
        request,
      }),
    ).rejects.toBeInstanceOf(TestHarnessInvariantError);
  });

  it("captures only explicit provider payload keys in memory and drains them", () => {
    interface Capture {
      readonly captureText: string;
      readonly schemaVersion: string;
    }
    const captures = new ProviderCaptureHarness<Capture>(["captureText", "schemaVersion"]);
    captures.capture({ captureText: "synthetic event", schemaVersion: "v1" });
    expect(captures.snapshot()).toEqual([{ captureText: "synthetic event", schemaVersion: "v1" }]);
    expect(captures.drain()).toHaveLength(1);
    expect(captures.snapshot()).toEqual([]);
    expect(() => {
      captures.capture({
        captureText: "synthetic event",
        schemaVersion: "v1",
        unrelatedHistory: "PRIVATE_CANARY",
      } as Capture);
    }).toThrow(TestHarnessInvariantError);
  });
});
