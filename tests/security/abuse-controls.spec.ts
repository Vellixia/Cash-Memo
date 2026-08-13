import { describe, expect, it } from "vitest";
import {
  AbuseControls,
  abuseOperationForRequest,
  abuseOperations,
} from "../../apps/server/src/modules/operations/abuse-controls.js";
const KEY = Buffer.from("synthetic-phase14-abuse-control-key-material-v1", "utf8");
describe("privacy-safe abuse controls", () => {
  it("defines controls for every required operation", () => {
    expect(abuseOperations).toHaveLength(9);
  });
  it("bounds account requests without exposing another account", () => {
    const controls = new AbuseControls(KEY, () => new Date("2026-08-13T00:00:00.000Z"));
    for (let index = 0; index < 60; index += 1)
      expect(controls.check("export", "account-a").allowed).toBe(true);
    expect(controls.check("export", "account-a").code).toBe("RATE_LIMITED");
    expect(controls.check("export", "account-b").allowed).toBe(true);
  });
  it("cannot bypass through idempotency-key variation", () => {
    const controls = new AbuseControls(KEY);
    for (let index = 0; index < 5; index += 1) controls.check("deletion", "same-principal");
    expect(controls.check("deletion", "same-principal").allowed).toBe(false);
  });
  it("returns fixed product-safe state only", () => {
    expect(Object.keys(new AbuseControls(KEY).check("search", "principal")).sort()).toEqual([
      "allowed",
      "code",
      "retryAfterSeconds",
    ]);
  });
  it("maps every protected HTTP operation without using payload or idempotency values", () => {
    expect(abuseOperationForRequest("POST", "/api/v1/auth/sign-up/email")).toBe("signup");
    expect(abuseOperationForRequest("POST", "/api/v1/auth/sign-in/email")).toBe("login");
    expect(abuseOperationForRequest("POST", "/api/v1/auth/request-password-reset")).toBe("reset");
    expect(abuseOperationForRequest("POST", "/api/v1/memos")).toBe("manual_capture");
    expect(abuseOperationForRequest("POST", "/api/v1/voice-captures/id/audio")).toBe("stt");
    expect(abuseOperationForRequest("POST", "/api/v1/drafts/text-extraction")).toBe(
      "ai_extraction",
    );
    expect(abuseOperationForRequest("POST", "/api/v1/memos/search")).toBe("search");
    expect(abuseOperationForRequest("POST", "/api/v1/exports?variant=x")).toBe("export");
    expect(abuseOperationForRequest("POST", "/api/v1/account-deletion")).toBe("deletion");
  });
});
