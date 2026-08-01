# Test Strategy: Money Memo Foundation

## Gate order and evidence

Feature is incomplete until every gate passes in constitution order:

1. Formatting and linting: Rustfmt, Clippy with warnings denied, ESLint, Prettier, OpenAPI/JSON
   Schema lint, Docker Compose validation.
2. Type checking: `cargo check --all-targets`, strict `tsc --noEmit`.
3. Unit/property tests: domain, application, client compose state, serialization.
4. Integration/contract tests: pinned real Appwrite 1.9.6, suppression object store, OpenTelemetry
   Collector/OpenObserve, Dexie in real browser.
5. Privacy tests: prohibited-input rejection and end-to-end diagnostic leak scans.
6. Acceptance evidence: each user story, performance criteria, usability study, purge retention,
   and real restore qualification.

Each evidence record contains commit/image digests, environment manifest, command, result,
duration, owner, timestamp, and artifact links under `docs/evidence/001/`. Logs attached to
evidence must already pass privacy scanner; raw sensitive canaries never enter shared artifacts.

## Controllable clock

Domain owns `Clock` port. Production uses monotonic-aware system UTC clock; tests use
thread-safe manual clock. All creation/update timestamps, ±10-year validation, deletion request,
30-day deadline, export lease, cursor expiry, backup destruction deadline,
`removal_not_before_at`, and scheduler age use port. Adapter does not use Appwrite `$createdAt` as
domain truth.

Tokio timer tests run with paused virtual time. Browser tests inject time facade/fake timers.
No automated test sleeps 30 real days. A 30-day scheduler scenario advances manual clock and
invokes runs at configured cadence.

Clock-skew tests cover export lease and backup manifest coordination. Production NTP offset is
monitored; export aborts if skew bound unavailable.

## Test layers

### Domain unit and property tests

- Amount parser rejects zero, sign, exponent, grouping/comma, excess precision, overflow, and
  one-minor-unit-over maximum; accepts exact maximum and currency scales 0/2/3/4.
- Export amount validator accepts exactly `minorUnitScale` fractional digits and rejects both too
  few and too many for every scale 0–4; scale 0 rejects decimal point.
- Currency registry rejects unsupported codes and preserves stored scale.
- Note boundary accepts exactly 1,000 Unicode scalar values and rejects 1,001 without value in
  error. Empty/omitted both become null.
- Input validator accumulates every field error in one response.
- Prohibited-pattern registry scans note and every user-managed text field before persistence;
  HTTP-422 failure response names field/rule and may include only published safe detector ID.
- Time invariant property: wall minus offset equals instant across random valid values.
- Boundary contract accepts only canonical UTC instants with six fractional digits and `Z`; offset
  tests accept exact ±14:00 and reject ±14:01 through ±14:59.
- Mixed-offset same-instant date filter includes only matching stored local date.
- Ordinary time edit preserves offset; offset change preserves wall; viewer-zone display mutates
  nothing. Ambiguous fall-back choice is stable; spring-forward gap rejected.
- Revision state machine applies whole mutation or none, increments once, never mutates immutable
  fields, and rejects field edits outside active.
- Archive/restore/delete idempotency; repeated delete preserves first deadline.
- Lifecycle boundary at exact deadline: unreachable for every use case before scheduler action.
- Fingerprint canonical golden vectors cover field order, exact decimals, Unicode, null note,
  references, offsets, and every creation field.
- Matching retry after arbitrary edits returns current lifecycle/revision without write.
- Mismatch in each individual creation field returns creation conflict.
- Label full case-fold uniqueness and reference-count state machine.
- Cursor AEAD tamper/owner/query/view/page-size/result-set-version/expiry binding and key rotation.
- Lexicographic cursor predicate property against in-memory total-order oracle.
- Export serializer round-trips all public fields and refuses any internal field.
- Suppression token key separation, deterministic construction, and
  `removal_not_before_at` calculation against random backup inventories.
- `MoneyMemo.purgeDeadline` contract requires property always, null for active/archived, canonical
  non-null UTC for pending deletion.
- `PRIVACY_INPUT_REJECTED` is HTTP 422 and may expose only safe published detector ID, field, and
  correction guidance; response-capture test rejects candidate/normalized/match derivatives.

### Browser/component tests

- One `crypto.randomUUID()` call per new compose session.
- Creation ID survives input, timeout, TanStack retry, reload, browser restart simulation, and
  Dexie recovery; new compose gets distinct ID.
- Zustand holds only live interface/compose state. TanStack Query holds server state. Dexie has
  no list/detail/export cache.
- Conflict UI shows recoverable user input beside current server resource; re-apply, discard,
  merge paths preserve typing.
- Network failure/reopen recovers edit and create payload.
- Currency change requires unsuppressible confirmation every time; no persisted “do not ask”.
- Offset change uses distinct explicit control and confirmation.
- Sort-generation conflict discards received page, never appends it, shows refresh action.
- Recently Deleted has no search/filter control and displays deadline.
- Delete and immediate purge use distinct destructive confirmations.
- Deactivated labels absent from picker, present on referenced memo and filter.
- Service worker stores only static versioned assets; API requests are network-only and
  `Cache-Control: no-store`.
- No form state, API body, search text, cursor, or export appears in console/crash capture.

### Real Appwrite 1.9.6 integration suite

Run against exact self-host image digest and chosen adapter. Test uses supported APIs only.

- Account/session validation, expired/revoked session, fail-closed auth.
- Direct browser TablesDB denial; server credential scope.
- Cross-user matrix for every endpoint and every search/filter combination.
- Compound unique creation race: 1,000 concurrent/simulated retries create exactly one memo.
- Same creation ID after 30 virtual days returns original/current state.
- Transaction read/update conflict: 1,000 two-writer runs, every loser gets conflict/current row,
  zero partial fields.
- Label case-fold unique race across active/deactivated rows.
- Label deletion/create-reference race; reference count never negative or stale.
- All defined compound indexes reach available state; index count/length under pinned limits.
- Three-key descending nested keyset query matches oracle at 10,000 rows.
- Cursor remains decodable without row anchor, but create/archive/restore/delete/purge/occurrence
  edit changes result-set version and rejects continuation with mandatory refresh.
- Recently Deleted cursor binds earliest `membershipValidUntil`; controlled clock crossing rejects
  continuation before mapping with scheduler disabled.
- Stable-version traversal returns every row exactly once. Membership-neutral non-sort edits
  preserve traversal. Current-query membership-changing edits invalidate before page acceptance.
- Appwrite list `ttl=0` prevents stale expired/recently-deleted result. A deliberate nonzero-cache
  control test demonstrates why setting is required.
- Search `contains` after Unicode normalization matches case/diacritic substring contract,
  multiple terms AND, note only, two-character term, no pending rows.
- Search/filter p95 under 1 second at 10,000 owner rows. No native full-text fallback permitted.
- Purge transaction removes memo/search shadow and decrements both label counts.
- Appwrite failure after suppression write leaves expired memo inaccessible and retryable.
- Export fence conflicts with in-flight mutation correctly; no undocumented snapshot claim.

Mocks/fakes may accelerate unit tests only. Real suite is release evidence for Appwrite behavior.

## Durable creation and cryptographic evidence

Automated tests prove implementation construction, not exhaustive cryptographic security:

- HMAC RFC vectors and project canonical vectors.
- OS CSPRNG key length and uniqueness checks.
- Wrapped per-memo key cannot be opened with wrong KEK/version/AAD.
- Constant-time comparison function used.
- Fingerprint/wrapped-key row inspection contains no readable amount/note.
- Dictionary of plausible amount/currency/date combinations cannot confirm a fingerprint without
  MAC key. Report as attack regression, never “exhaustive proof”.
- KEK rotation rewraps every key, leaves fingerprint/revision/domain timestamps unchanged, and
  remains verifiable before/after real backup restore.
- Missing/corrupt/retired-too-early KEK fails closed with stable retryable error and no create.
- Separate keys/domain separators for fingerprint, cursor, purge token, user partition, and
  telemetry correlation.

Security owner reviews threat model before release, annually, after crypto/storage change, and
after suspected key compromise. Review states resistance assumes attacker has stored fingerprint
but not runtime/escrow KEK and unwrapped per-memo key.

## Pagination concurrency model tests

Reference model records page-one query, cursor tuple, result-set version, eligible set, generation
dimensions, and mutation sequence.
Generate interleavings with:

- stable result set with no mutation;
- insert above/below cursor;
- archive/restore/delete/purge before and after cursor;
- membership-neutral non-sort edits;
- note/type/currency/filter edits that change current-query membership;
- occurrence edit anywhere in result set;
- identical occurrence/creation timestamps with ID tie-break;
- expired/tampered/wrong-owner/wrong-filter cursor.

Assertions:

1. With unchanged membership and ordering, each memo is emitted exactly once with zero omission.
2. Every page returns one opaque `resultSetVersion`; every continuation supplies it and cursor
   binds it.
3. Create/archive/restore/delete/purge/occurrence edit changes base generation; request, cursor, or
   pre/post-query version mismatch discards page and visibly requires refresh. Recently Deleted
   deadline crossing invalidates through bound `membershipValidUntil` without scheduler action.
4. Current-query membership-changing search/filter edit changes relevant dimension generation and
   invalidates; unrelated membership-neutral non-sort edit preserves version and traversal.
5. Purged/expired row is never emitted to honor cursor history.
6. No test labels traversal snapshot-isolated.

## Export consistency and format tests

- Validate every file with `contracts/export-v1.schema.json` and independent parser.
- Exact amount strings for JPY 1000, USD 42.50, BHD 1.500, and scale-4 registry example.
- Occurrence instant/wall/offset reconstruct same value and local date.
- Active default; active+archived explicit; pending/expired never present.
- Reference arrays contain exactly referenced labels, unique IDs, accepted-instant names/states.
- Denylist scan: owner, revision, creation ID/fingerprint/wrapped key, note search, cursor,
  export lease, deletion timestamps/deadline, purge/suppression metadata absent.
- 10,000 memos produce complete file under memory budget; forced memory/schema/read/lease failure
  returns error before response bytes/headers and cleans buffer.
- 100 qualification runs attempt 100 mutations/second. Harness records committed mutation order;
  successful export equals state at fence commit, no duplicate version, and later writers commit
  only after release. Writers receive retryable visible error and preserve drafts.
- Backend crash expires lease; no partial artifact remains; next export succeeds.
- Search/log/telemetry captures contain no exported bytes or excerpt.

## Lifecycle, scheduler, and suppression tests

Use manual clock and real dependencies:

- Exact deadline with scheduler disabled is inaccessible through read, list, archive, Recently
  Deleted, search, every filter, export, restore, creation retry, and label reference surface.
- Under normal service availability, scheduled worker runs hourly virtual cadence for 30 virtual
  days; every expired memo is deleted before 24-hour age with no access attempts.
- Stop executor before deadline, advance beyond 24 hours, and separately fail Appwrite and
  suppression storage. Inaccessibility holds; stale-heartbeat, overdue-backlog, and 24-hour-breach
  alerts fire using aggregate fields only. Restore each dependency and prove next scheduled run
  automatically discovers and idempotently clears every overdue row without manual replay state.
- Kill worker after token write and after Appwrite delete, then recover. Duplicate token, absent
  row, transaction conflict, and overlapping workers converge to one deletion and correct label
  counts. Operational evidence records outage start/end, alert delivery, recovery run IDs, oldest
  overdue age, aggregate counts, and backlog-clear time—never memo/owner IDs or deletion tokens.
- Access fallback purges once, returns same not-found as never-issued ID, and does not replace
  scheduled sweep.
- Overlapping workers, repeated commands, duplicate ledger object, delete conflict, missing row,
  and partial dependency failure remain idempotent.
- Suppression-store failure prevents physical delete and raises stable alert; financial data
  remains inaccessible.
- Full post-purge sweep covers all surfaces enumerated in `data-model.md`.
- Ledger inspection contains exactly `deletion_token`, `purged_at`, and
  `removal_not_before_at`; token is keyed/non-reversible and contains no owner/memo metadata.
- Eligibility equals maximum `destruction_deadline_at` of every complete/in-progress capable
  backup. Advancing clock past it alone never deletes current/noncurrent token versions.
- Verified destruction of every capable backup permits conditional token cleanup and absence
  proof. Failed/unverifiable destruction retains token, raises alert, retries, and blocks cleanup
  and affected restore cutover.
- Purge-key rotation remains usable for every live token; missing key blocks restore cutover.

## Backup/restore evidence

### Pre-release 100-cycle qualification

Platform automation performs 100 separate actual cycles, not mocks:

1. Seed two users, memos, labels, one future pending deletion, one expired pending deletion.
2. Capture real quiesced Appwrite backup with manifest.
3. After capture, purge selected memos and durably write independent tokens.
4. Restore backup into fresh isolated exact-version Appwrite stack.
5. Run supported-API reconciliation; keep public routing absent.
6. Assert post-backup purged rows absent, expired restored row inaccessible/deleted, other rows
   intact, owners isolated, counts/reference integrity valid.
7. Run second token scan, privacy scan, checksums, then destroy drill stack within 24 hours.

Omit ledger, omit key, corrupt manifest, truncate enumeration, and force delete conflict in
negative cycles; every one must refuse cutover. Passing mock/fake does not count.

Repeat 100-cycle qualification after Appwrite backend/version, backup tooling/scope, retention,
purge-token construction, key management, or restore workflow change.

### Continuing drill

Platform/Operations owns quarterly real isolated restore from latest production-like encrypted
backup. Security signs suppression reconciliation. Backend feature owner witnesses application
integrity. Incident commander owns missed retention/purge/restore gate. See runbooks.

## Privacy tests

Canary set contains unique synthetic amount, note, category/space name, search term, creation
fingerprint marker, auth token, prohibited-pattern examples, and export fragment. Exercise:

- success and every validation error;
- stale conflict/current resource;
- creation conflict;
- auth/authorization denial;
- Appwrite timeout/error body;
- search success/failure;
- cursor error;
- export success/failure;
- panic/crash path;
- scheduler/ledger/restore failure.

Scan backend/frontend stdout, reverse-proxy/Appwrite/container logs, HTTP error messages, captured
OTLP logs/traces/metrics, OpenObserve stored signals, crash reports, and build/test artifacts.
Scan raw, JSON-escaped, URL-encoded, and base64 forms. Expected count for all sensitive canaries
is zero. Request/trace/run IDs and low-cardinality codes are allowed.

Pattern Set v1 tests use exact `B1`–`B9` and `W1`–`W3` definitions in `research.md` R-17; tests may
not broaden behavior without versioning specification, product copy, fixtures, and review together.

- Golden positive/negative fixtures cover preprocessing, line/32-scalar boundaries, separator
  handling, Unicode digits, every keyword, length boundary, Luhn/ABA/mod-97 checksum pass/fail,
  `B8` marker/row thresholds, and all government-ID forms.
- Browser blocking fixtures prove zero network request, byte-exact Dexie/compose preservation,
  adjacent warning, field-only error, correction and retry. Malicious-client bypass fixtures prove
  server rejection before persistence.
- Warning fixtures prove text initially remains local while edit/remove/continue paths preserve it
  byte-exactly. Continue creates no attestation field. Server reruns detector, rejects `B1`–`B9`,
  and may accept warning-only `W1`–`W3`; search offers clear or continue without logging value.
- Inject panic/crash before, during, and after each detector. Scan browser reports, Axum/reverse
  proxy/Appwrite logs, OTLP/OpenObserve, analytics capture, and evidence artifacts for original,
  NFKC/digit-normalized, URL/JSON escaped, hashed, base64, and matched-substring forms. Expected
  count is zero.
- Labeled false-positive corpus includes phone/order/tracking/gift-card/reference numbers,
  educational banking prose, innocuous `PIN`/`NIK`, and statement-like tables. Labeled declared-
  pattern false-negative corpus mutates separators, checksums, labels, distances, lengths, and row
  counts. Report detector-by-detector counts; no release claim extends beyond declared fixtures.
- Threat review records known false negatives: unlisted languages/formats, bank names alone,
  unlabeled/obfuscated/spelled-out values, OCR errors, novel tokens/statements, and semantic text.

Tests establish deterministic Pattern Set v1 behavior and diagnostic isolation. They do not prove
arbitrary global text contains no prohibited semantic value and must never be presented as doing so.

## Cross-user isolation matrix

For each row below, seed user A and B with matching IDs/search/filter-like values where possible.
Run authenticated A against B ID and broad/empty combinations:

| Surface | Required result |
|---|---|
| create retry identity | uniqueness scoped to A; B identity cannot be confirmed |
| active/archive/recent list | zero B rows |
| direct read | identical `NOT_FOUND` to random ID |
| edit/archive/restore/delete/purge | identical `NOT_FOUND`; B unchanged |
| search, empty search, every filter and combination | zero B rows |
| cursor replay | wrong-owner cursor invalid |
| export default/include archived | zero B rows/references |
| label query/rename/state/delete/reference check | zero B data/effect |
| scheduler/admin-key scan | owner-neutral selection, correct row-only action, no exposed owner |
| restore reconciliation | token computation global but no owner data; nonmatching B intact |

## Performance tests

- Dataset: 10,000 memos/user, realistic note length distribution, worst-case 1,000-character
  notes, mixed offsets/lifecycle/filter cardinality; at least two users.
- Search/filter p95 <1 second in production-equivalent Compose resources, measured server-side
  and end-to-end separately; warm/cold runs recorded; `ttl=0` always.
- Keyset page default 50/max 200; full traversal exact-once oracle.
- Export 10,000 complete under bounded memory and lease deadline.
- Creation/edit normal personal workload plus 100 attempted mutations/second export stress.
- Index/profiler evidence collected without logging query values or memo content.

Failure of normalized substring search p95 is architecture decision gate. Native full-text is not
fallback because semantics differ. Next option requires separately reviewed owner-scoped search
structure without new service unless concrete evidence justifies it.

## 20-user usability procedure

Owner: Product Research. QA owns timing harness. Privacy reviewer approves study capture.

- Recruit 20 representative first-time users; use synthetic scenarios only, never real finances.
- Start create timer when compose screen is interactive; stop on confirmed save.
- First-attempt means no abandonment/reset and a valid confirmed memo on first submit.
- Pass SC-001 when median completion <30 seconds.
- Pass SC-002 when at least 19 of 20 succeed first attempt.
- Give same participants synthetic 2,000-memo journal and target; pass SC-014 when median find
  time via search/filter <15 seconds.
- Retain participant code, task timing, completion boolean, and de-identified observation only.
  Do not record entered amount/note/search text, screen replay, or raw session.
- Run before launch and after material compose/search/deletion/export UX redesign.

## Acceptance ownership

| Evidence | Owner | Cadence |
|---|---|---|
| Domain/API/client gates | Backend/Web/QA | Every PR and release |
| Real Appwrite contract/performance | Backend + Platform | Every release; after Appwrite change |
| Privacy leak scan | Security + QA | Every release; every telemetry/error change |
| Pattern Set v1 fixtures/false-result report | Security + QA | Every release; every detector/copy change |
| 20-user study | Product Research | Pre-launch; material UX changes |
| Purge SLO/backlog | Platform | Hourly monitoring; daily review |
| Scheduler outage/recovery and overdue-alert drill | Platform + QA | Pre-launch; every release; quarterly |
| Backup inventory/retention | Platform | Daily |
| 100 restore qualification | Platform + Security | Pre-launch; material backup/purge changes |
| Real restore drill | Platform + Security + feature owner | Quarterly |
| Crypto threat model/key inventory | Security | Pre-launch, quarterly inventory, annual review, incident/change |
