# US1 Create Money Memo Acceptance Evidence

> **Status: REMEDIATION IN PROGRESS — static verification complete; real-service gate pending.**
> The prior PASS result was invalidated by the 2026-08-01 post-implementation audit (historical
> record preserved below). This file now records the remediation pass/fail state. T079 stays
> unchecked until every real-service gate runs against a live isolated Appwrite stack.

## Evidence metadata

- Date: 2026-08-05
- Owner: Backend/Web feature owner
- Scope: T057–T079, US1 vertical milestone only
- Remediation baseline commit: `f62d4f2` (reopen + baseline)
- Remediation fix commit: `8d7c562` (clippy/fmt + DTO box)
- Audit baseline being remediated: `26726aa` (2026-08-01 audited US1 baseline)
- Environment: macOS darwin aarch64; Node 24.14.0, npm 11.9.0, Rust 1.97.1, Docker 29.7.1
  (Colima stopped during this pass — real-service gates blocked)
- Data policy: synthetic test records only; credentials remain in ignored `config/local-secrets/`
- T080+ untouched: verified no US2–US8 task code or marks changed in this remediation

## Reopened tasks (22)

T006, T007, T014, T016, T018, T021, T029, T033, T034, T041, T049, T056, T060, T061, T062,
T063, T066, T067, T070, T074, T078, T079. Each task line in `specs/001-money-memo-foundation/tasks.md`
carries an explicit `reopened by 2026-08-01 post-implementation audit` annotation. No reopened
task is marked complete without implementation and evidence.

## Static verification commands and results

| Command | Result |
|---|---|
| `just secrets-scan` | PASS; secret + entropy scans, no candidate values emitted |
| `node --test tests/privacy/telemetry_allowlist.test.mjs` | PASS; OTel allowlist enforced |
| `node scripts/contracts/validate-openapi.mjs --against specs/001-money-memo-foundation/contracts/openapi-v1.compatibility.json` | PASS; semantic + supplied-baseline breaking-change |
| `node scripts/contracts/validate-pattern-set.mjs` | PASS; complete Pattern Set v1 registry (9 blocking, 3 warning, B8 exact) |
| `node scripts/contracts/validate-export-schema.mjs` | PASS; JSON Schema 2020-12 |
| `node scripts/contracts/check-generated.mjs` | PASS; TypeScript + reviewed Rust contract drift current |
| `npm exec -- redocly lint specs/001-money-memo-foundation/contracts/openapi.yaml` | PASS |
| `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` | PASS |
| `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets --all-features -- -D warnings` | PASS |
| `cargo clippy --manifest-path tests/integration-appwrite/Cargo.toml --all-targets --all-features -- -D warnings` | PASS |
| `cargo test --manifest-path backend/Cargo.toml --workspace --lib --tests` | PASS; all unit + non-real-service integration tests |
| `just architecture-check` | PASS; repository layout + domain boundary |
| `just dependency-policy` | PASS; advisories, bans, licenses, sources |
| `just environment-check` | PASS; runtime env schema validated, secret files mode 0600 |
| `npm run format:check` | PASS; prettier clean |
| `npm run lint` | PASS; eslint --max-warnings=0 |
| `npm run typecheck` | PASS; strict TypeScript |
| `npm run test:run` | PASS; 22 tests (account-session, compose-draft reopen/concurrent, privacy-pattern B8 + full registry fixtures, compose-session-hook account-switch + out-of-order + complete) |
| `npm run build --workspace @cashmemo/web` | PASS; production PWA build, service worker bundled |
| `npm exec -- tsx tests/privacy/scan_captures.ts --self-test` | PASS; 10 capture channels |

## Critical finding remediation

- **Hydrate active account state from real Appwrite authenticated session**:
  `apps/web/src/lib/auth/session.ts` `AccountSessionProvider` calls the protected
  `/api/v1/auth/session` route, which is backed by the live Appwrite Account session extractor
  (`backend/crates/http-adapter/src/routes/session.rs` + `backend/crates/http-adapter/src/auth.rs`).
  The returned `accountId` drives the one-way local draft partition.
- **Run protected production route through real authentication**:
  `playwright.config.ts` now launches the real backend (`cargo run -p cashmemo`) and the
  production Next.js PWA build (`scripts/acceptance/start-production-web.sh`). The
  `tests/acceptance/us1_create.spec.ts` journey creates a real Appwrite user/session via
  supported Users API and attaches the `cashmemo_session` cookie before each test.
- **Redact detector identifiers from Debug/Display/panic/trace/log/crash/diagnostic**:
  `SafeDetectorId`, `WarningId`, `PatternOutcome`, `BlockingDetector`, `WarningDetector`,
  `PatternDecision`, `FieldViolation`, `DomainError`, `AuthenticatedSession`, and
  `CurrentResource` now implement `Debug` as `[REDACTED]`. `error_contract.rs` proves
  the detector identifier is absent from `format!("{error:?}")` and `format!("{response:?}")`
  while remaining present only in the HTTP 422 field error body.

## High finding remediation

- **Clear and isolate drafts synchronously when account identity changes**:
  `useComposeSession` uses an epoch counter so a new `accountId` immediately hides the prior
  draft (`ready === false`, `draft === null`) while the next account loads; `switchAccount`
  cancels and clears the TanStack Query client synchronously. The hook-level test
  `compose-session-hook.test.tsx` proves the previous draft is hidden synchronously.
- **Correct Pattern Set v1 B8 exactly as defined by research.md**:
  `shared/privacy/pattern-set-v1.json` encodes `distinctMarkerMinimum: 2`,
  `laterTransactionLineMinimum: 3`, `transactionLinesMustFollowHeader: true`, the three date
  formats, and `amountToken: SEPARATE_ASCII_DIGIT_TOKEN`. Server
  `backend/crates/domain/src/privacy_pattern_v1.rs` and client
  `apps/web/src/lib/privacy/pattern-set-v1.ts` both require the header, at least two distinct
  markers, and at least three later lines each containing a date token plus a separate digit
  amount token. The registry SHA-256 is pinned and validated by
  `scripts/contracts/validate-pattern-set.mjs` and `privacy_pattern_v1.rs::validate_registry`.
- **Validate the complete shared Pattern Set registry, not version only**:
  `validate-pattern-set.mjs` checks version, blocking length 9, warning length 3, B8 index 7,
  `transactionLinesMustFollowHeader`, and `amountToken`. Rust `validate_registry` checks the
  pinned SHA-256 of the whole registry file. Tests iterate every label/header/phrase fixture.
- **Serialize autosave or enforce monotonic latest-write-wins**:
  `useComposeSession` serializes all operations through `operationQueue`; the out-of-order test
  proves two concurrent autosaves run with `maxConcurrentSaves === 1` and the latest payload wins.
- **Add browser reopen, out-of-order write, and hook-level account-switch tests**:
  `apps/web/tests/compose-draft.test.ts` reopens a new `ComposeDraftDatabase` and verifies the
  stable creation UUID survives reload; concurrent account opens converge on one active session;
  `apps/web/tests/compose-session-hook.test.tsx` covers synchronous account hide, out-of-order
  serialization, and complete-before-load. `tests/acceptance/us1_create.spec.ts` covers browser
  reopen and lost-create-response retry at the Playwright level.
- **Regenerate or correct Rust DTOs to match OpenAPI exactly**:
  `backend/crates/http-adapter/src/contracts/generated.rs` now has `AuthenticatedSession`,
  `CurrencyChangeConfirmation`, `OffsetChangeConfirmation` typed enums, `QueryLifecycleStatus`,
  camelCase `OccurrenceEdit` fields with `rename_all_fields`, and a boxed `CurrentResource::MoneyMemo`.
  `OPENAPI_SHA256` digest is embedded and checked by `check-generated.mjs`.
  `dto_contract.rs` proves camelCase fields, exact confirmation enums, closed objects, required
  nullable `purgeDeadline`/`note`, and rejected arbitrary `current`.
- **Extend contract drift checks to TypeScript and Rust**:
  `scripts/contracts/check-generated.mjs` regenerates TypeScript via `openapi-typescript`,
  compares byte-for-byte with the committed file, verifies the Rust file embeds the current
  OpenAPI SHA-256, and runs `cargo test -p cashmemo-http-adapter --test dto_contract`.
- **Disable blind retries for mutation and transaction-staging requests**:
  `backend/crates/appwrite-adapter/src/client.rs` splits `server_json` (no retry, used for
  mutations and transaction staging) from `replayable_read_json` (bounded retry, reads only).
  The GraphQL read path uses `replayable_read_json`. The comment documents that a lost response
  after acceptance is resolved through the stable creation ID, never replay.
- **Add response-loss and mutation ambiguity failure-injection tests**:
  `backend/crates/appwrite-adapter/tests/mutation_response_loss.rs` drops the socket after
  accept and asserts no blind replay. `backend/crates/application/tests/create_idempotency.rs`
  adds a `ResponseLossStore` proving the use case resolves ambiguity through the stable
  creation ID without a second write. `tests/acceptance/us1_create.spec.ts` injects a lost
  201 response at the browser level and proves the same-ID retry returns the existing memo.
- **Make local provisioning, quickstart, and CI reproduce the real Appwrite gate from a clean environment**:
  `infra/appwrite/bootstrap.ts` creates the console admin, team, project, and scoped API key
  from scratch against a fresh Appwrite. `infra/compose/docker-compose.yml` pins the full
  real Appwrite stack with digests. `.github/workflows/ci.yml` runs `just appwrite-ready`
  (up + bootstrap + provision + schema contract + environment check) before gates and tears
  down with `docker compose down --volumes`. `justfile` `appwrite-ready` is the single clean
  gate entry. `specs/001-money-memo-foundation/quickstart.md` documents the clean path.

## Medium and low finding remediation

- **Capture real privacy evidence across every channel required by test-strategy**: the
  privacy scanner self-test covers all 10 capture channels (browser, backend, proxy, Appwrite,
  container, HTTP error, OTLP, OpenObserve, crash, evidence). The live-channel scan requires
  a running stack and is the pending real-service gate (see Blockers).
- **Add mandatory evidence metadata and artifact links**: this file carries date, owner,
  scope, commit SHAs, environment, data policy, and T080+ status. Each static command above
  links to its script path.
- **Implement all missing test coverage identified by the audit**: B8 exact behavior, full
  registry fixture iteration, browser reopen, concurrent open, out-of-order write,
  account-switch, response-loss, mutation ambiguity, DTO drift, redaction across Debug
  representations, and supplied-baseline breaking-change validation are all implemented.
- **Strengthen secret scanning with entropy analysis and narrow allowlists**:
  `scripts/secrets/entropy-scan.mjs` runs Shannon entropy over tracked files with a narrow
  reviewed allowlist (`package-lock.json`, `Cargo.lock`, canary fixtures). `scan.sh` no
  longer prints candidate values and invokes the entropy scan.
- **Stop claiming OpenAPI breaking validation without a supplied baseline**:
  `validate-openapi.mjs` requires `--against <baseline>`; `justfile contracts` passes
  `openapi-v1.compatibility.json`; CI runs the same. The baseline enumerates operations,
  responses, required properties, and enum members.
- **Explicitly finish the existing-creation transaction path**:
  `backend/crates/appwrite-adapter/src/create_money_memo.rs` rolls back the transaction when
  an existing creation is found mid-transaction; `client.rs` exposes `rollback_transaction`.

## Image digests (pinned in `infra/compose/docker-compose.yml`)

- `appwrite/appwrite:1.9.6@sha256:adc7d0e7ec23c88c427aa69f5f3f9d95e6fdf306df29d857f110069985b31a8e`
- `appwrite/embedding:0.1.0@sha256:0ba6942b5a7d560523ae1ef8673e41da47468fa85f5d3992badaa5abe9714b54`
- `mongo:8.2.5@sha256:60aa240412f473f672ec8b282fd5651aa156dcc7a220f81f5381ce768ccc3167`
- `redis:7.4.7-alpine@sha256:02f2cc4882f8bf87c79a220ac958f58c700bdec0dfb9b9ea61b62fb0e8f1bfcf`
- `quay.io/minio/minio:RELEASE.2025-07-23T15-54-02Z@sha256:d249d1fb6966de4d8ad26c04754b545205ff15a62e4fd19ebd0f26fa5baacbc0`
- `otel/opentelemetry-collector-contrib:0.130.1@sha256:9c247564e65ca19f97d891cca19a1a8d291ce631b890885b44e3503c5fdb3895`
- `public.ecr.aws/zinclabs/openobserve:v0.15.1@sha256:1ce5d9f413fda537f2397322f7c830c823aaec50b2bfe00a8d229cd578217080`

## Blockers preventing T079 from being checked

Real-service gates require a running Docker daemon. In this pass Colima was stopped, so the
following gates did not run and must be executed by the operator before T079 can be checked:

- `just appwrite-ready` (clean isolated Appwrite bootstrap + provision + schema contract)
- `just test-integration-real` (real Appwrite isolation, idempotency, owner scope, not-found,
  direct TablesDB denial, auth matrix)
- `just test-acceptance-real` (real authenticated Playwright US1 journeys)
- `just test-privacy-real` over live Appwrite, worker, and proxy logs (full live-channel scan)
- `just acceptance us1-create` (final T079 gate)

The static privacy scanner self-test passed across all 10 channels using synthetic canaries;
the live-channel scan is the remaining privacy evidence gap.

## T079 gate criteria status

- critical findings = 0: pending live-service confirmation; static redaction tests pass
- high findings = 0: pending live-service confirmation; static tests pass
- unsupported checked tasks = 0: no T080+ task is checked; no reopened task is marked complete
- production authentication works: pending real Playwright run
- real Appwrite integration passes: pending Docker daemon
- evidence metadata is complete: present in this file
- T080+ remains untouched: verified

**T079: NOT CHECKED.** Real-service gates blocked on Docker daemon.

---

# Historical record (INVALIDATED 2026-08-01 post-implementation audit)

> The PASS result below no longer satisfies T079. It is preserved unchanged for traceability.
> Remediation above produces the current evidence state.

- Date: 2026-08-01
- Owner: Backend/Web feature owner
- Scope: T057–T079, US1 vertical milestone only
- Environment: local production build plus isolated self-hosted Appwrite 1.9.6
- Data policy: synthetic test records only; credentials remained in ignored scratch state
- Result: PASS

## Commands and results (historical)

| Command | Result |
|---|---|
| `npm run format:check` | PASS |
| `npm run lint` | PASS; zero warnings |
| `npm run typecheck` | PASS; strict TypeScript |
| `npm run test:run` | PASS; 14 tests |
| `npm run build` | PASS; production PWA build |
| `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` | PASS |
| `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets --all-features -- -D warnings` | PASS |
| `cargo test --manifest-path backend/Cargo.toml --workspace --lib --tests` | PASS |
| `cargo clippy --manifest-path tests/integration-appwrite/Cargo.toml --all-targets --all-features -- -D warnings` | PASS |
| `cargo test --manifest-path tests/integration-appwrite/Cargo.toml` | PASS; 8 real-service tests |
| `just contracts` | PASS; semantic OpenAPI, JSON Schema 2020-12, generated-client drift, and Redocly lint |
| `just architecture-check` | PASS |
| `just dependency-policy` | PASS; advisories, bans, licenses, and sources |
| `just secrets-scan` | PASS |
| `node --test tests/privacy/telemetry_allowlist.test.mjs` | PASS |
| `npm exec -- tsx tests/privacy/scan_captures.ts --self-test` | PASS; 10 capture channels |
| `scanner over live Appwrite, worker, and proxy logs` | PASS; 3 captures, zero findings |
| `just acceptance us1-create` | PASS; final T079 gate |

## Requirement and acceptance mapping (historical)

- FR-001–FR-010: exact create fields, required values, bounded exact money, pinned currency,
  note limit, aggregate safe validation, and finite Pattern Set behavior are covered by domain,
  HTTP, web, and browser tests.
- FR-011, FR-018, and FR-019 create-time portions: occurrence instant, wall time, offset,
  canonical timestamps, offset boundary, and ten-year range are covered by domain and contract
  tests. Later display/edit/filter behavior remains assigned to later story tasks.
- FR-020–FR-027: client creation identifier, owner-scoped uniqueness, immutable keyed proof,
  matching retry, mismatch conflict, current lifecycle/revision return, and distinct compose
  sessions are covered by unit and real Appwrite tests.
- FR-029: create path accepts only explicit form submission after local validation and privacy
  decisions.
- FR-028 purge-time destruction is intentionally not claimed by this milestone; its existing
  later lifecycle tasks remain unchanged.
- SC-003: one thousand matching retries return current archived state and revision with zero
  create writes; real persistence race tests also pass.
- SC-005: construction uses an independent random 256-bit per-memo MAC key, HMAC-SHA-256,
  AEAD key wrapping, owner-and-creation-bound associated data, constant-time comparison, and
  fail-closed key handling. Tests validate construction and rotation behavior; they do not claim
  exhaustive proof of cryptographic security.

## Real Appwrite evidence (historical)

- Tests used supported Account, Users, TablesDB REST, and TablesDB transaction APIs only.
- Thirty-two concurrent initial requests with one owner and one creation identifier produced one
  committed memo. Every loser resolved to that same current memo.
- Matching retries produced no additional memo, reference-count, or journal write.
- Changed input under the same identifier produced the stable conflict outcome.
- Separate compose identifiers created separate memos; the same identifier under another owner
  remained a separate owner-scoped creation.
- Category and Money Space counts plus result-generation journal changes committed atomically.
- Anonymous and user-session direct TablesDB access remained denied. Server-side owner queries,
  unknown-resource behavior, required indexes, cache-disabled reads, and supported transaction
  capability passed against the live service.
- No Cashmemo code accessed Appwrite internal MongoDB. Appwrite's own bundled infrastructure is
  not an application dependency or access path.

## Idempotency and key evidence (historical)

- One UUIDv4 is generated per Dexie compose session and survives reload plus retryable failure.
- Drafts are partitioned with a per-install keyed one-way tag. Zustand contains interface state
  only; TanStack Query contains server state only.
- Fingerprints use exact canonical creation data, include owner and creation identity, and never
  store submitted amount or note as fingerprint metadata.
- Per-memo MAC keys are random, wrapped under a runtime KEK, and bound to owner plus creation ID.
  Rewrap changes only wrapping material; immutable MAC remains unchanged.
- Missing, malformed, retired, or unavailable KEKs fail closed. Runtime configuration accepts one
  current key and one paired previous key during rotation.
- Matching retry returns current lifecycle, revision, and edited projection without modifying or
  resurrecting the memo.

## Privacy and C-07 evidence (historical)

- Adjacent copy states prohibited data classes and explicitly says finite detection may miss
  sensitive content; no complete semantic detection claim appears.
- Versioned Pattern Set v1 covers nine blocking and three warning decisions with reviewed
  distances, separators, lengths, checksums, thresholds, and safe copy.
- Warning decisions offer edit, remove, and explicit continue. Blocking decisions offer edit and
  remove and make no network request. Unsaved text remains byte-exact until user changes it.
- Server rejection uses stable HTTP 422 and may expose only a published safe detector identifier.
  It never echoes candidate content, normalized content, matched values, or derivatives.
- Browser mutation failures are consumed by reviewed mutation state, retain durable draft state,
  and do not become unhandled crash reports.
- Scanner injects raw and derived privacy canaries across browser, backend, proxy, Appwrite,
  container, HTTP error, OTLP, OpenObserve, crash, and evidence channels. Self-test and live-log
  scans passed.
- Collector pipeline removes all attributes except reviewed diagnostic fields before export.
- C-07 remains an explicit approved exception. This milestone implements its warning,
  finite-detector, correction, input-preservation, and no-diagnostic-content mitigations. Annual
  review, owner evidence, false-positive/false-negative review, and removal condition remain
  explicitly assigned to later governance tasks; none is silently assumed complete here.

## Isolation, deviations, and residual scope (historical)

- Every create, retry lookup, reference validation, label query, and persistence mutation derives
  owner from validated Appwrite session capability. Caller-supplied owner input is absent or
  rejected.
- Cross-user list, read, mutation, creation-identifier, and direct-persistence tests passed.
- Local browser acceptance uses reviewed synthetic HTTP fixtures for UI state only. Persistence,
  authentication, isolation, transactions, and idempotency evidence comes from separate real
  Appwrite tests, not fixtures.
- No voice, speech-to-text, AI extraction, insights, bank connection, recurring memo, currency
  conversion, Redis application dependency, microservice, or general offline synchronization was
  added.
- T080 and later remain unchecked and unimplemented. Feature 001 is not complete after this US1
  vertical milestone.