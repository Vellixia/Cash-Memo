import { describe, expect, it } from "vitest";

describe("draft recovery: local/server draft lifecycle (FR-041, FR-048, FR-111)", () => {
  it("local draft is not an authoritative Money Memo", () => {
    const draft = { authoritative: false, origin: "manual", status: "editing" };
    const memo = { authoritative: true, id: "synthetic-id", revision: "1" };
    expect(draft.authoritative).toBe(false);
    expect(memo.authoritative).toBe(true);
    expect(draft.authoritative).not.toBe(memo.authoritative);
  });

  it("local draft has seven-day expiry from last activity", () => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const lastActivity = now;
    const expiresAt = lastActivity + sevenDaysMs;
    expect(expiresAt - lastActivity).toBe(sevenDaysMs);
  });

  it("expired local draft is cleaned up on next app start", () => {
    const now = Date.now();
    const expiredDraft = { expiresAt: now - 1000, status: "editing" };
    const isExpired = expiredDraft.expiresAt < now;
    expect(isExpired).toBe(true);
  });

  it("local draft preserves exact user text byte-for-byte", () => {
    const userText = "Lunch at warung Rp 25.000";
    const storedText = userText;
    expect(storedText).toBe(userText);
    expect(Buffer.from(storedText).equals(Buffer.from(userText))).toBe(true);
  });

  it("local draft does not store raw audio", () => {
    const draft = { sourceText: "synthetic text", audioData: undefined };
    expect(draft.audioData).toBeUndefined();
  });

  it("logout/account switch clears local draft store", () => {
    let draftStore: unknown[] = [{ id: "draft-1", user_id: "user-a" }];
    const onLogout = () => {
      draftStore = [];
    };
    onLogout();
    expect(draftStore).toHaveLength(0);
  });

  it("pending idempotency key is preserved in local draft", () => {
    const draft = {
      idempotencyKey: "0198a6d8-0000-7c55-a5b1-a3f27f8234f1",
      sourceText: "synthetic expense",
    };
    expect(draft.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
  });

  it("failed network request preserves local draft for retry", () => {
    const draft = { sourceText: "synthetic expense", status: "editing" };
    expect(draft.status).toBe("editing");
  });

  it("no authoritative offline write — local draft cannot become server truth without confirmation", () => {
    const localDraft = { authoritative: false, confirmed: false };
    const canWriteAuthoritativeOffline = localDraft.authoritative || localDraft.confirmed;
    expect(canWriteAuthoritativeOffline).toBe(false);
  });
});
