# US1 Create Money Memo Acceptance Evidence

> **INVALIDATED — 2026-08-01 post-implementation audit.** This historical report is preserved
> unchanged below for traceability. Its PASS result no longer satisfies T079. Remediation must
> produce a new evidence record with complete metadata and a fresh real-service gate.

- Date: 2026-08-01
- Owner: Backend/Web feature owner
- Scope: T057–T079, US1 vertical milestone only
- Environment: local production build plus isolated self-hosted Appwrite 1.9.6
- Data policy: synthetic test records only; credentials remained in ignored scratch state
- Result: PASS

## Commands and results

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
| scanner over live Appwrite, worker, and proxy logs | PASS; 3 captures, zero findings |
| `just acceptance us1-create` | PASS; final T079 gate |

## Requirement and acceptance mapping

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

## Real Appwrite evidence

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

## Idempotency and key evidence

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

## Privacy and C-07 evidence

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

## Isolation, deviations, and residual scope

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
