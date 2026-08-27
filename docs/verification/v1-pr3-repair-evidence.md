# Cashmemo V1 PR3 repair evidence

## Account deletion password confirmation

- `cancellation_requires_password_then_revokes_restricted_session_and_clears_cookie` proves a
  deletion-only session cannot cancel with a wrong password; successful cancellation revokes that
  session, expires its cookie, and a new login receives `Full` access.
- `request_rejects_status_changed_after_password_verification_without_full_session` and
  `cancellation_rejects_hash_changed_after_password_verification_without_full_session` pause
  after Argon2 verification. A second PostgreSQL connection changes the user record before the
  transition lock; each transition rejects stale confirmation, preserves the externally changed
  state, and leaves no full-access session.
- `account_deletion_request_clears_session_cookie` proves successful deletion request expires the
  browser session cookie and revokes its token.

## Corrected baseline assertion

- Previous expectation: `concurrent_login_and_deletion_leave_no_live_full_session` required zero
  non-revoked sessions.
- Approved contradiction: when deletion wins the row lock, a concurrent login may legitimately
  create one `DeletionOnly` session.
- Corrected expectation: no surviving session may have `SessionAccess::Full`; a surviving
  `DeletionOnly` session is permitted.
- Protected regression: the race test obtains any concurrent login session and asserts its access
  is not `Full`.

## Verification

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test account_deletion --test auth --test ownership`

Result: 29 tests passed.

## Transaction local-time write contract

- `manual_local_times_use_stored_timezone_and_reject_invalid_inputs` proves Jakarta
  `2026-08-31T23:30` stores as `2026-08-31T16:30:00+00:00`; New York's ambiguous
  `2026-11-01T01:30` chooses earlier `2026-11-01T05:30:00+00:00`; nonexistent,
  seconds, offset, `Z`, and impossible inputs return `422`.
- Same test proves omitted create uses server `Utc::now()` and omitted update preserves exact
  stored instant.
- `entry_defaults_select_only_most_recent_active_wallet_for_authenticated_user` asserts exact
  defaults shape: `last_used_wallet_id` plus stored IANA `timezone`, with no server local time.

## Transaction time verification

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test transactions --test ownership`

Result: 13 tests passed.

## Local-calendar history and reporting contract

- History accepts exact `YYYY-MM-DD` `from` and `to` values as inclusive user-local dates, then
  applies half-open UTC bounds. Jakarta boundary fixtures prove inclusion at local midnight and
  exclusion at next-day midnight; Pacific/Apia's skipped 2011-12-30 resolves to an empty range.
- History and recent transaction reads return current wallet and category names while retaining
  user-scoped joins and stable cursor ordering.
- Monthly summary, selected-month recent transactions, and budget summary share local-calendar
  month boundaries. Reports exclude future transactions.
- Expense-category shares use decimal division, midpoint-away-from-zero rounding, clamping to
  `0.00..100.00`, and an exact two-decimal string representation.

## Local-calendar verification

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test history -- --nocapture`

Result: 6 tests passed.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test reporting -- --nocapture`

Result: 5 tests passed.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test history --test reporting --test budgets`

Result: 16 tests passed.

## Recurrence calendar-anchor resume contract

- Root cause: resume used mutable, clamped `next_due_date` as recurrence origin. A monthly
  Jan-31 rule parked at Feb-29 resumed on Aug-29 instead of Aug-31.
- `first_due_on_or_after` now uses direct daily, weekly, monthly, and yearly arithmetic from
  immutable `start_date`; monthly/yearly candidates clamp only final candidate date.
- `resume_uses_start_date_anchor_after_clamp_without_backfill_or_duplicates` covers a long-paused
  Jan-31 rule with Feb-29 scheduler state, confirms no pause backfill, one resumed occurrence,
  and no duplicate after a second processor run.
- `first_due_on_or_after_jumps_from_immutable_calendar_anchor` covers Jan-31, Jan-30, Feb-29,
  and weekly weekday anchors.

## Recurrence verification

RED:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test recurring -- --nocapture`

Result: expected failure in `resume_uses_start_date_anchor_after_clamp_without_backfill_or_duplicates`:
returned `2026-08-29`; expected `2026-08-31`.

GREEN, repeated for idempotency:

`for run in 1 2 3; do DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test recurring || exit 1; done`

Result: each run passed, 13 tests total.

## Editable wallet opening balance and durable onboarding completion

- Root cause: wallet PATCH exposed only `name`, while migration `0005` installed a trigger that
  rejected every opening-balance change. Onboarding completion was recomputed from complete
  starter categories plus an active wallet, so archived-only accounts could reopen onboarding and
  already-completed accounts did not repair missing starter categories.
- Baseline correction: `updates_name_but_rejects_immutable_currency_and_opening_balance` and
  `rejects_direct_wallet_currency_and_opening_balance_changes` encoded opening-balance
  immutability. Approved repair design section 9 instead requires optional wallet `name` and
  `opening_balance` updates while currency remains immutable. Corrected tests allow exact opening
  balance changes, retain currency rejection, and protect cross-user wallet ownership.
- `0009_wallet_onboarding_repair.sql` additively removes both the obsolete trigger and function,
  adds `users.onboarding_completed_at`, and backfills the same migration timestamp for qualifying
  users with active or archived wallets. A user without any wallet remains incomplete.
- Wallet update locks the owned wallet, reads its currency exponent from the registry, validates
  exact nonnegative decimal input, and updates only supplied wallet fields. The regression proves
  current balance changes while transaction count, monthly report, and budget summary stay exact.
- Onboarding reconciliation seeds every missing normalized starter category once, preserves an
  existing completion timestamp, sets first-wallet completion once, and treats archived-only
  completed accounts as onboarded. Repeated reads create no duplicate starters; no seed version or
  state machine was added.

### Wallet/onboarding verification

RED evidence:

- Required combined RED stopped in migrations because version 9 and
  `onboarding_completed_at` were absent.
- `updates_name_and_opening_balance_without_changing_financial_activity` returned `422`; expected
  `200`.
- `rejects_empty_currency_negative_and_excess_scale_wallet_updates` failed because
  `opening_balance` was an unknown PATCH field instead of a field-level validation path.
- Onboarding reconciliation tests failed because `onboarding_completed_at` did not exist and the
  qualifying derived state returned `categories_seeded: false`.
- Obsolete ownership baseline failed at `wallet opening balance must be immutable` after migration
  0009, proving the exact approved-design contradiction before correction.

GREEN:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test migrations -- --nocapture`

Result: 9 tests passed, including version-9 checksum identity, trigger/function removal, and
active/archived-wallet backfill.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test ownership -- --nocapture`

Result: 7 tests passed, including currency immutability, editable opening balance, and cross-user
ownership constraints.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test wallets --test onboarding --test migrations --test reporting --test transactions`

Result: 38 tests passed: migrations 9, onboarding 7, reporting 5, transactions 6, wallets 11.

## Deletion-receipt key-version binding

- Root cause: replay verified that a receipt's declared `key_version` existed, but then compared
  its HMAC against every configured key. A canonical v1 receipt carrying a v2 HMAC could therefore
  delete the matching restored user.
- Replay now performs exact `key_for_version(keyring, receipt.key_version)` lookup and verifies
  only that declared-key HMAC with `Mac::verify_slice`. Canonical body, object-key, and
  known-version validation still finish before restored-database matching and transactional
  deletion.
- Real S3-compatible integration coverage proves valid v1/v1 and v2/v2 replay, declared v1 with a
  v2 HMAC failing closed, unknown version failing closed, malformed body and object key failing
  closed, and a second replay deleting nothing.
- Existing S3 receipt tests retain immutable PUT retry/idempotency and divergent-object behavior.

### Deletion-receipt verification

Local Docker CLI had no Compose plugin, so the specified commands used installed
`docker-compose` 5.3.1 with dedicated project `cashmemo-pr3-task6`. Only `restored-postgres` and
`deletion-receipts` started: PostgreSQL at `127.0.0.1:56430`, MinIO at
`127.0.0.1:32774`.

RED:

`cargo test -p cashmemo-api --features s3-receipts --test deletion_receipt_replay -- --nocapture`

Result: expected failure in `declared_v1_receipt_with_v2_hmac_never_purges`: `users_purged` was
`1`; expected `0`. Other 6 replay tests passed.

GREEN:

`cargo test -p cashmemo-api --test deletion_receipt_replay --test deletion_receipts --features s3-receipts`

Result: replay 7 tests passed; S3 receipt PUT/retry suite 3 tests passed.

Cleanup: `docker-compose -p cashmemo-pr3-task6 -f infra/v1/test-compose.yml down --volumes --remove-orphans`
removed both containers and the named network. Follow-up project `ps -a` returned an empty table.

### Round 1 constant-time verification repair

- Root cause: exact key-version binding still derived an ordinary `[u8; 32]` candidate and used
  array `==`, whose comparison was not the required constant-time MAC verification primitive.
- Focused RED added fixed HMAC vectors for correct declared key, modified tag, and a v2 tag checked
  under declared v1 key. It failed to compile because minimal `verify_user_id_hmac` did not exist.
- Focused GREEN: 3 verifier unit tests passed. Production resolves exact declared key first, then
  constructs `Hmac<Sha256>` and calls `Mac::verify_slice`; it no longer materializes or compares a
  candidate tag.
- `delete_failure_rolls_back_earlier_replay_deletions` uses two deterministic matched users and
  valid recurring data whose immutable occurrence blocks second cascade. Replay rolls back first
  deletion, reports zero purged and two unprocessed, and preserves both users.
- Fresh `cashmemo-pr3-task6` integration run used PostgreSQL `127.0.0.1:56430` and MinIO
  `127.0.0.1:32776`: account deletion 11 passed, replay 8 passed, receipt PUT/retry 3 passed.
  Concrete S3 receipt success followed by database final-delete failure and identical retry passed.
- Final named-project cleanup removed both containers and network; follow-up project `ps -a`
  returned an empty table.

## Trusted-proxy-aware auth throttling

- Root cause: auth limiter keyed only the Axum TCP `ConnectInfo<SocketAddr>`. Behind Traefik that
  address is the shared proxy peer, so distinct public clients consumed one IP bucket. Trust was
  neither configurable nor transferred through a bounded, authenticated proxy suffix.
- `CASHMEMO_V1_TRUSTED_PROXY_CIDRS` is parsed as comma-separated CIDRs during `serve` startup.
  Empty trusts nobody; malformed input stops startup. V1 retains one API replica and its bounded
  in-memory limiter. No Redis or persistent attempt history was added.
- Direct untrusted peers remain authoritative and all supplied `X-Forwarded-For` values are
  ignored. A trusted direct peer activates a right-to-left scan that strips configured trusted
  proxies and returns the first untrusted IP literal. It examines no more than 8192 total header
  bytes, the rightmost 2048 bytes, and 16 hops. Once a client is established, hostile left-prefix
  values are not parsed.
- Trusted forwarding with a missing, malformed, all-trusted, overlong, or over-hop suffix returns
  `400 INVALID_FORWARDING_METADATA` before identifier parsing, limiter mutation, or auth-handler
  execution. A trusted address left of an already-established untrusted client grants nothing.
- HTTP middleware tests inject real `ConnectInfo` extensions. They prove direct spoof resistance,
  trusted-suffix stripping, two clients behind one proxy using distinct buckets, hostile-left
  early stop, internal trusted-address non-escalation, and pre-handler rejection.
- `main.rs` already served the router through
  `into_make_service_with_connect_info::<SocketAddr>()`; the repair retains that required peer
  propagation. The operations suite exercises the real TCP server path.

### Trusted-proxy RED/GREEN evidence

Initial RED:

`cargo test -p cashmemo-api --test http_safety -- --nocapture`

Result: compile failed because `TrustedProxyConfig` and the trusted-proxy-aware limiter constructor
did not exist. A direct-peer-only mutation reproducing the baseline then ran
`two_clients_behind_one_trusted_proxy_keep_distinct_ip_buckets`: client `203.0.113.9` received
`429`, expected `401`, proving both clients shared the Traefik peer bucket.

Header-bound mutation RED: removing the 8192-byte check let an oversized hostile left prefix with
a valid rightmost client reach the handler (`401`, expected pre-handler `400`). Restoring the check
made that HTTP test pass.

Compose RED:

`bash infra/v1/test-dokploy-compose.sh`

Result: three expected failures: missing required API trusted-proxy CIDRs, missing rendered API
CIDRs, and missing explicit Traefik safe-append/header-limit contract.

GREEN:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test http_safety --test operations`

Result: 19 tests passed (`http_safety` 12, `operations` 7).

`bash infra/v1/test-dokploy-compose.sh`

Result: `Compose contract PASS`.

Traefik is external to this Compose project. `x-traefik-static-arguments` records exact Dokploy
operator configuration: `insecure=false`, safe append via `notAppendXForwardedFor=false`, optional
exact upstream `trustedIPs`, and `http.maxHeaderBytes=8192`. The Compose contract asserts all four
arguments and the API CIDRs. Actual managed-Traefik config and public two-client probes remain a
pre-route-activation operational gate; this task made no Dokploy or production mutation.

## Read-only schema-aware readiness

- Root cause: `/api/v1/health/ready` issued only `SELECT 1`, so an empty database, a stale V1
  migration prefix, failed migration, divergent migration checksum, and unknown non-empty database
  all incorrectly returned `200`.
- `check_latest_v1_readiness` now calls the existing V1 target guard only. It verifies expected
  table set, `cashmemo`/`v1` identity, and successful checksummed migrations 1 through 9 with
  SELECT queries; it never initializes metadata, obtains advisory locks, runs migrations, or
  repairs state.
- Readiness tests snapshot public tables, public column schema, and `_sqlx_migrations` version,
  success, and checksum before and after each request. Exact current V1 alone returns `200`; empty,
  stale-prefix, failed, checksum-divergent, and unknown non-empty states return canonical `503`
  responses with preserved request ID. Liveness remains `200` without database connectivity.

GREEN:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57432/cashmemo_e2e cargo test -p cashmemo-api --test operations --test migrations --test http_safety`

Result: 34 tests passed (`http_safety` 12, `migrations` 9, `operations` 13).

## Canonical request IDs and safe request logs

- Root cause: restricted `GET /sessions/current` and `POST /sessions/revoke-all` minted fresh
  `RequestId`s for errors, while the auth extractor and origin/rate-limit middleware could also
  fall back to fresh IDs. Error envelopes could therefore disagree with the response header for
  one request. Request logs emitted only request ID, status, and latency.
- Request-ID attachment remains the outermost app middleware. Incoming IDs must be canonical UUIDs
  of the exact accepted size; malformed values receive a generated canonical UUID. Auth routes,
  extractor, origin policy, rate limiter, and request logger now require and reuse that attachment.
- Structured `http_request` records contain only `request_id`, `method`, matched route template
  (or literal `<unmatched>`), `status`, `latency_ms`, `service`, and `version`, plus the event
  discriminator. URI and query strings are never logged.

### Canonical ID/log RED/GREEN evidence

RED:

- Restricted current-session request returned body request ID
  `0fda5273-1b1f-4aeb-a417-a3e1b069d966`, not incoming
  `cbca2e85-4d7c-4ce6-9a8c-69f7e647905b`.
- Structured log test contained only `event`, `latency_ms`, `request_id`, and `status`; required
  method, route, service, and version were absent.

GREEN:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57433/cashmemo_e2e cargo test -p cashmemo-api --test http_safety --test operations --test auth -- --test-threads=1`

Result: 41 tests passed (`auth` 15, `http_safety` 13, `operations` 13). Serial test threads avoid
SQLx temporary-database cleanup collisions observed when these database-backed tests run in
parallel.

Log privacy evidence: real TCP matched and hostile unmatched requests carried password, token,
note, and amount values in body/query. Captured JSON logs assert matched route
`/api/v1/health/live`, unmatched route `<unmatched>`, and absence of every raw query/path prefix
and secret value.
