import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AccountDeletionService,
  SEVEN_DAYS,
} from "../../src/modules/deletion/account-deletion.service.js";
import { ProviderDeletionService } from "../../src/modules/deletion/provider-deletion.service.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT = "00000000-0000-4000-8000-000000000164";
const OTHER = "00000000-0000-4000-8000-000000000165";
const NOW = new Date("2026-08-11T12:00:00.000Z");
const HMAC = Buffer.from("synthetic-account-deletion-hmac-key-32-bytes", "utf8");

describe("account deletion lifecycle against real PostgreSQL", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let admin: Pool;
  let runtime: Pool;
  let clock = new Date(NOW);
  let service: AccountDeletionService;
  let providers: ProviderDeletionService;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL missing");
    admin = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(admin);
    await admin.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'deletion-owner@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'deletion-other@cashmemo.test', true, 'active')`,
      [ACCOUNT, OTHER],
    );
    runtime = new Pool({
      connectionString: environment.postgres.connectionUri,
      options: "-c role=cashmemo_runtime",
    });
    service = new AccountDeletionService({ hmacKey: HMAC, now: () => clock, pool: runtime });
    providers = new ProviderDeletionService({ now: () => clock, pool: runtime });
  }, 120_000);

  beforeEach(async () => {
    clock = new Date(NOW);
    await admin.query("DELETE FROM provider_deletions");
    await admin.query("DELETE FROM account_deletions");
    await admin.query("DELETE FROM export_jobs");
    await admin.query("DELETE FROM idempotency_records");
    await admin.query("DELETE FROM sessions");
    await admin.query("UPDATE users SET status = 'active'");
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
    await environment.stop();
  });

  it("starts exact seven-day grace and suspends journal access", async () => {
    const result = await service.request(ACCOUNT, crypto.randomUUID());
    expect(result.state).toBe("grace");
    expect(Date.parse(result.graceEndsAt) - Date.parse(result.requestedAt)).toBe(SEVEN_DAYS);
    await expect(service.journalAccessState(ACCOUNT)).resolves.toBe("suspended");
  });

  it("cancels during grace and restores journal access", async () => {
    const requested = await service.request(ACCOUNT, crypto.randomUUID());
    const canceled = await service.cancel(ACCOUNT, requested.revision);
    expect(canceled.state).toBe("canceled");
    await expect(service.journalAccessState(ACCOUNT)).resolves.toBe("active");
  });

  it("replays duplicate request identity without another deletion", async () => {
    const key = crypto.randomUUID();
    const first = await service.request(ACCOUNT, key);
    const replay = await service.request(ACCOUNT, key);
    expect(replay.id).toBe(first.id);
    expect(
      (await admin.query("SELECT count(*)::int AS count FROM account_deletions")).rows[0],
    ).toEqual({
      count: 1,
    });
  });

  it("cancels active export jobs when deletion enters grace", async () => {
    await admin.query(
      `INSERT INTO export_jobs
         (id, user_id, schema_version, requested_at, state, snapshot_cutoff, revision)
       VALUES (gen_random_uuid(), $1, '1.0', $2, 'queued', $2, 1)`,
      [ACCOUNT, NOW],
    );
    await service.request(ACCOUNT, crypto.randomUUID());
    expect(
      (await admin.query<{ state: string }>("SELECT state FROM export_jobs")).rows[0]?.state,
    ).toBe("canceled");
  });

  it("keeps existing session state during grace for cancellation/disclosures", async () => {
    await admin.query(
      `INSERT INTO sessions (id, user_id, token, expires_at)
       VALUES (gen_random_uuid(), $1, 'synthetic-session-token', now() + interval '1 day')`,
      [ACCOUNT],
    );
    await service.request(ACCOUNT, crypto.randomUUID());
    expect((await admin.query("SELECT count(*)::int AS count FROM sessions")).rows[0]).toEqual({
      count: 1,
    });
  });

  it("transitions at grace expiry using calendar duration and becomes irreversible", async () => {
    const requested = await service.request(ACCOUNT, crypto.randomUUID());
    clock = new Date(Date.parse(requested.graceEndsAt));
    const purging = await service.beginIrreversible(ACCOUNT);
    expect(purging.state).toBe("purging");
    expect(purging.irreversibleAt).toBe(clock.toISOString());
    await expect(service.cancel(ACCOUNT, purging.revision)).rejects.toMatchObject({
      code: "IRREVERSIBLE_DELETION",
    });
  });

  it("keeps another account active and unable to observe owner deletion", async () => {
    await service.request(ACCOUNT, crypto.randomUUID());
    await expect(service.journalAccessState(OTHER)).resolves.toBe("active");
    await expect(service.status(OTHER)).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_NOT_FOUND",
    });
  });

  it("reports provider deletion independently from live purge", async () => {
    const requested = await service.request(ACCOUNT, crypto.randomUUID());
    await admin.query(
      `INSERT INTO provider_deletions
         (id, user_id, account_deletion_id, provider_decision_version, scope, state)
       VALUES (gen_random_uuid(), $1, $2, 'synthetic-v1', 'storage', 'queued')`,
      [ACCOUNT, requested.id],
    );
    expect((await service.status(ACCOUNT)).providerState).toBe("pending");
  });

  it("represents failed purge explicitly and supports idempotent retry", async () => {
    const requested = await service.request(ACCOUNT, crypto.randomUUID());
    clock = new Date(Date.parse(requested.graceEndsAt));
    const purging = await service.beginIrreversible(ACCOUNT);
    const failed = await service.markFailed(ACCOUNT, purging.id);
    expect(failed.state).toBe("failed");
    const retry = await service.retryFailed(ACCOUNT);
    expect(retry.state).toBe("purging");
    expect(retry.irreversibleAt).toBe(purging.irreversibleAt);
  });

  it("does not equate deletion request or live purge with completion", async () => {
    const requested = await service.request(ACCOUNT, crypto.randomUUID());
    expect(requested.state).not.toBe("complete");
    clock = new Date(Date.parse(requested.graceEndsAt));
    const purging = await service.beginIrreversible(ACCOUNT);
    const live = await service.markLivePurged(ACCOUNT, purging.id);
    expect(live.state).toBe("live_purged");
    expect(live.providerState).toBe("not_started");
  });

  it("tracks not-required and pending provider states without provider payload", async () => {
    const requested = await service.request(ACCOUNT, crypto.randomUUID());
    const states = await providers.initialize(ACCOUNT, requested.id, {
      ai: { decisionVersion: "zdr-v1", required: false },
      email: { decisionVersion: "ses-v1", required: true },
      storage: { decisionVersion: "s3-v1", required: true },
      stt: { decisionVersion: "zdr-v1", required: false },
    });
    expect(states.map(({ scope, state }) => ({ scope, state }))).toEqual([
      { scope: "stt", state: "not_required" },
      { scope: "ai", state: "not_required" },
      { scope: "email", state: "queued" },
      { scope: "storage", state: "queued" },
    ]);
    expect(JSON.stringify(states)).not.toMatch(/payload|response|accountId|emailAddress/iu);
  });

  it("keeps failed provider deletion pending and completes only confirmed/not-required stages", async () => {
    const requested = await service.request(ACCOUNT, crypto.randomUUID());
    await providers.initialize(ACCOUNT, requested.id, {
      ai: { decisionVersion: "zdr-v1", required: false },
      email: { decisionVersion: "ses-v1", required: true },
      storage: { decisionVersion: "s3-v1", required: false },
      stt: { decisionVersion: "zdr-v1", required: false },
    });
    clock = new Date(Date.parse(requested.graceEndsAt));
    await service.beginIrreversible(ACCOUNT);
    await service.markLivePurged(ACCOUNT, requested.id);
    await providers.markRequested(ACCOUNT, requested.id, "email");
    await providers.markFailed(ACCOUNT, requested.id, "email", true);
    await expect(providers.reconcileAccountState(ACCOUNT, requested.id)).resolves.toBe(
      "provider_pending",
    );
    await providers.markConfirmed(ACCOUNT, requested.id, "email");
    await expect(providers.reconcileAccountState(ACCOUNT, requested.id)).resolves.toBe("complete");
  });
});
