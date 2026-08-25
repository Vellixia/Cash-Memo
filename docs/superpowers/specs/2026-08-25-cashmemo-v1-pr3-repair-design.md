# Cashmemo V1 PR #3 Repair Design

**Date:** 2026-08-25  
**Classification:** ARCHITECTURAL  
**Branch:** `rewrite/cashmemo-v1`  
**Reviewed baseline:** `e59bf67c59dc0c31ffb3fef3b56f68bea4331f10`  
**Merge target:** `main`  
**Pull request:** <https://github.com/Vellixia/Cash-Memo/pull/3>

## 1. Purpose and Boundary

PR #3 is not approved for merge. This design defines a focused repair of confirmed Cashmemo V1
correctness, security, CI, and UI/UX defects, followed by an independent merge-readiness review.

The approved architecture stays unchanged:

```text
Next.js App Router + TypeScript + shadcn/Base UI + Tailwind
                            |
                    Orval/Axios REST
                            |
                     Rust/Axum /api/v1
                            |
                         PostgreSQL
```

Rust and PostgreSQL remain authoritative for money, financial time, balances, budgets, recurrence,
account lifecycle, authorization, and persistence. The frontend owns form state, immediate UX
validation, server-state lifecycle, navigation state, and presentation.

This task authorizes repository changes and disposable local/hosted test infrastructure only. It
does not authorize merge, deployment, Dokploy mutation, production database access, production
migration, production routing, cutover, or destructive production action.

## 2. Goals and Non-goals

Goals:

- Repair every confirmed finding with test-first evidence.
- Correct only tests proven to contradict approved V1 behavior, with an audit trail.
- Stabilize backend contracts before regenerating OpenAPI and Orval.
- Replace homemade interactive behavior with current shadcn components backed by Base UI.
- Establish a forest-green, warm-neutral Tailwind token system.
- Rebuild major flows for commercial-quality mobile, desktop, accessibility, and financial clarity.
- Repair Linux recovery-test portability and web-container vulnerability gates without weakening
  them.
- Pass local and hosted gates against the exact reviewed integration target.
- Perform independent review of both the repair delta and full PR.

Non-goals remain bank sync/import, FX conversion, transfers, AI, voice, OCR, receipts, investments,
debt, goals, accounting/tax, shared accounts, tags, nested categories, complex budgets, rollover,
arbitrary recurrence, offline financial writes, Redis, Redux, Zustand, GraphQL, queues,
microservices, a second backend, dark mode, and all production/cutover work.

## 3. Confirmed Baseline Findings

- Deletion cancellation can let a restricted session become full after user activation.
- Manual `datetime-local` values use browser timezone.
- History filters use UTC-day boundaries.
- Recurrence resume can promote a clamped due date into a new anchor.
- Wallet opening balance is incorrectly immutable.
- Receipt replay compares HMAC against every key instead of declared `key_version`.
- Auth throttling has no Traefik trusted-proxy model.
- Readiness only runs `SELECT 1`.
- Some auth errors create a second request ID.
- HTTP completion logs omit safe method/route fields.
- Reporting can round authoritative money before display.
- Recovery Bats use BSD-only `date -v`.
- Web runtime contains fixable Debian vulnerabilities and unused vulnerable npm `tar@7.5.7`.
- Frontend has no Tailwind/shadcn configuration and uses raw/home-grown controls.

Hosted CI also proves the Rust concurrency assertion is ordering-dependent, preservation tests fail
on GNU `date`, and web Trivy fails under the required HIGH/CRITICAL policy.

## 4. Repair Slices

Use independent TDD commits:

1. auth/deletion lifecycle;
2. transaction financial datetime contract;
3. history/report calendar boundaries;
4. recurrence anchors;
5. wallet opening balance and stable onboarding completion;
6. deletion-receipt verification;
7. trusted-proxy rate limiting;
8. readiness/migration identity;
9. request ID and structured logging;
10. exact-money invariant;
11. Linux recovery-test portability;
12. web-container vulnerability repair.

Each slice records RED command/reason, minimal GREEN change, focused verification, surrounding
suite, and commit. A baseline test changes only with this record:

```text
previous expectation
why it contradicted approved design
corrected expectation
regression now protected
```

Backend contracts stabilize before OpenAPI/Orval generation. The UI design system is built before
screens migrate flow by flow.

## 5. Auth and Account Deletion

Pending-deletion state remains enumeration-safe:

```text
nonexistent email OR wrong password
→ identical invalid-credentials response

correct credentials + pending_deletion
→ DeletionOnly session
→ clear private query state
→ /deletion without mounting /app
```

`POST /api/v1/account/deletion/cancel` requires a valid `DeletionOnly` session and current password.
The service first loads the current password hash and account state, then performs expensive
Argon2id verification outside any database transaction. After successful verification it begins a
transaction, locks the user row, confirms the account is still `pending_deletion`, and confirms the
locked password hash/state matches the values that were verified. A changed hash or state fails the
cancellation and requires re-authentication. Only then does the transaction activate the user,
revoke every active session, and commit. Success expires `__Host-cashmemo_session`; the frontend
clears private cache and returns to login. Fresh normal login is required for `Full` access.

Wrong password leaves account pending and restricted session usable for another cancellation
attempt. It does not clear the cookie.

Deletion request remains a purpose-built password-confirmed flow. Success stores authoritative
`deletion_due_at`, revokes all sessions, clears cookie, cancels/invalidates financial requests,
clears private cache, unmounts normal shell, and navigates safely. In-flight responses cannot
repopulate reusable private cache.

The prior race test expected zero sessions. That contradicts approved pending-deletion login, which
may create a deletion-only session after deletion commits. Correct invariant: no usable `Full`
session survives either ordering. Tests cover both orderings, cancellation, and fresh login.

## 6. Financial Time

Manual writes accept one exact local format:

```text
occurred_local = YYYY-MM-DDTHH:mm
```

Seconds, offsets, `Z`, malformed/impossible dates, and normalization are rejected. Rust resolves the
wall clock using authenticated user's IANA timezone:

```text
unique      → exact UTC instant
ambiguous   → earlier instant
nonexistent → 422 field error
```

Database stores `TIMESTAMPTZ`; reads expose one canonical RFC3339 UTC `occurred_at`. Update omits
`occurred_local` to preserve the stored instant. Frontend formats `occurred_at` with the Cashmemo
timezone and sends `occurred_local` only when React Hook Form marks that field dirty.

Entry defaults return `last_used_wallet_id` and `timezone`. Frontend formats current instant through
`Intl` with that timezone; browser timezone never determines financial meaning.

History accepts inclusive semantic local dates. For example:

```text
from=2026-08-25&to=2026-08-27
→ occurred_at >= boundary(2026-08-25 local midnight)
→ occurred_at <  boundary(2026-08-28 local midnight)
```

A boundary is first valid instant at or after requested local midnight. A fully skipped date can
therefore have a zero-length effective interval. One helper serves history, report/dashboard months,
budget months, monthly recent transactions, and recurring local-date conversion where applicable.

Timezone changes never update transaction instants, occurrence scheduled dates, generated
transactions, or generated occurrence records. They may regroup existing instants into different
local days/months and affect future scheduled-date conversion. UI confirms these consequences with
the actual new timezone before saving.

## 7. Transaction and Dashboard Read Contracts

Transaction reads used by history, recent, Trash, and detail add current `wallet_name` and
`category_name`. They are current referenced names, not snapshots.

URL filter state contains `from`, `to`, `type`, `wallet`, and `category`. Free-text `q` stays
ephemeral React/request state; cursor also stays ephemeral. Mobile Sheet applies edits once and
offers Clear all. Explicit Load more preserves existing pages and retries only failed pagination.

Future manual transactions may appear in intentional history with `Future`, but until
`occurred_at <= now()` they affect no current balance, realized totals, budgets, or dashboard recent
reporting.

Dashboard month is `?month=YYYY-MM`. Monthly summary, budget summary, and recent transactions all
use it. Each currency owns independent income, expense, net, category composition, and budgets.
There is no combined total or chart scale.

Monthly category reporting adds server-derived `share_percent` as a decimal string with canonical
scale 2 and range `0.00..100.00`. Rust derives it from exact category expense divided by exact total
expense for that currency and rounds presentation only with
`rust_decimal::RoundingStrategy::MidpointAwayFromZero`. Each category is rounded independently, so
display percentages need not sum to exactly `100.00`. Example:

```json
{
  "expense": "100000",
  "share_percent": "33.33"
}
```

React may convert only `share_percent` to a JS number for proportional bar width. Budget progress
uses the same decimal-string scale and rounding convention where applicable, but remains
nonnegative and may exceed `100.00`.

Rust/OpenAPI exposes `share_percent` as `type: string` with scale/range description and examples;
neither generated TypeScript nor JSON uses a floating-point percentage field.

## 8. Recurrence Anchors

`start_date` is recurrence anchor; `next_due_date` is mutable scheduler state. Resume computes the
first cadence occurrence on or after current user-local date from `start_date`. It never promotes a
clamped due date into a new anchor and uses calendar arithmetic rather than daily iteration from
ancient history.

Required cases are Jan-31 monthly, Jan-30 monthly, Feb-29 yearly, weekly weekday, long pause,
no paused-period backfill, and occurrence uniqueness. Rule edits apply to future occurrences only.
Existing occurrences/generated transactions remain unchanged. `next_due_date` displays as semantic
local `DATE`; frontend never converts it through UTC `Date`.

## 9. Wallet Opening Balance and Stable Onboarding

Wallet update accepts optional `name` and `opening_balance`, with at least one required semantically.
Currency is absent and immutable. An additive migration drops both immutability trigger and its
unused function; committed migrations are not rewritten.

Rust validates balance against wallet currency exponent: exact, nonnegative, in range, no excess
scale. Edit changes current wallet balance but creates no transaction and changes no history,
income, expense, net, or budget spent. The incorrect immutability test is replaced only after its
spec contradiction is documented.

Add durable `users.onboarding_completed_at`, set once timezone, default currency, idempotent category
seeding, and first successful wallet satisfy onboarding. Before completion, backend derives:

```text
timezone missing                         → Timezone
timezone set + default currency missing → Currency
preferences set + no first wallet       → First wallet
requirements satisfied                  → completed; /app
```

Archiving or hard-deleting the only wallet after completion never reopens onboarding.

For new users, the backend sets `onboarding_completed_at` once initial onboarding succeeds. The
additive migration deterministically backfills existing V1 users whose current state already has a
configured timezone, configured default currency, and at least one active or archived wallet.
Category seeding is reconciled idempotently. The exact backfill timestamp is not product-significant;
the invariant is that applying the repair migration to a qualifying already-onboarded V1 database
does not reopen onboarding. A real migration/integration test covers that upgrade path.

Wallet archive invalidates wallet list, recurring list, and entry defaults. Restore invalidates
wallet/default queries but never resumes recurrence. Opening-balance edit invalidates wallet queries
only.

## 10. Receipt Verification

Replay validates canonical receipt body and object key, then:

```text
receipt.key_version
→ exact key lookup
→ HMAC(user_id) using that key only
→ constant-time comparison
```

It never searches all keys for any match. Unknown/unavailable version, malformed/divergent receipt,
or declared-version/HMAC mismatch fails closed. Replay remains transactional and idempotent.

## 11. Trusted-proxy Rate Limiting

V1 keeps one API replica and bounded in-memory limiter; no Redis or attempt history. Configure:

```text
CASHMEMO_V1_TRUSTED_PROXY_CIDRS
```

Empty trusts nobody. Forwarded addresses are inspected only when direct TCP peer is trusted.
Effective chain is `X-Forwarded-For + direct peer`. Traefik must sanitize/overwrite forwarding
headers from untrusted clients or safely append the actual remote address. Its HTTP configuration
rejects forwarding headers above 8192 bytes before they reach Rust.

Rust walks the chain right-to-left, strips configured trusted proxies, and chooses the first valid
untrusted IP literal. It inspects at most the rightmost 2048 bytes and 16 hops. Once that client hop
is established, it does not parse attacker-controlled entries farther left. Therefore a malformed
or spoofed left prefix cannot turn an identifiable real client into the shared Traefik address. A
trusted address somewhere inside the header grants no trust.

Direct untrusted requests ignore forwarding headers. If a request arriving from a trusted proxy has
no trustworthy client hop within the bounded suffix, Rust rejects that individual auth request as
invalid forwarding metadata instead of assigning the shared proxy IP bucket or calling the auth
handler. Identifier limiting remains separate. Deployment verification documents and tests actual
Traefik sanitization/append behavior, header limits, and Axum peer propagation.

## 12. Readiness

`GET /api/v1/health/ready` remains cheap `200`/`503`. Strict read-only validation checks DB
connectivity, exact Cashmemo V1 identity, SQLx history presence, all expected successful versions,
embedded checksums, and absence of stale/incomplete/failed/unknown state. It performs no lock,
migration, repair, insertion, or initialization. Only explicit migration command mutates state.

Tests cover current V1, empty DB, stale prefix, failed/incomplete history, and wrong unknown DB.

## 13. Request IDs and Logs

One middleware-created request ID flows through extractors, middleware, handlers, logs, error body,
and response header. Auth handlers stop constructing fresh IDs.

Completion logs include `request_id`, method, matched route template, status, latency, service, and
version. Unmatched routes log constant `<unmatched>`, never raw URI/query. Logs exclude cookies,
passwords, tokens, notes, financial bodies, and arbitrary query contents.

## 14. Exact Money

One formatter serves transactions, balances, budgets, and reports:

```text
Decimal + exponent
→ normalize
→ require normalized fractional scale <= exponent
→ rescale only for canonical output
→ decimal string
```

`1.2300` is valid for exponent 2; `1.231` is not. No rounding discovers representability.
Corrupt-scale persistence produces invariant/persistence error. Derived percentage rounding remains
separate. Text budget progress may exceed 100%; graphical Progress alone clamps to `[0,100]`.

Frontend `MoneyAmount` never calls `Number`/`parseFloat` on money. It groups exact string digits,
optionally deriving separators from safe constant samples. Direction uses sign, text, and accessible
semantics; color reinforces only.

## 15. Contract-generation Gate

Before UI work, coherent Rust contracts include:

- password-confirmed deletion cancellation and cookie semantics;
- `occurred_local` writes and canonical `occurred_at` reads;
- semantic local history dates;
- entry-default timezone;
- optional wallet opening-balance update;
- transaction wallet/category names;
- dashboard category share percentage;
- month-scoped recent transactions;
- readiness documentation where exposed.

Then run Rust contract tests, deterministic OpenAPI export, deterministic Orval generation, and
`git diff --exit-code` limited to expected generated surfaces. Generation repeats only for genuine
contract defects; UI never targets knowingly transitional types.

## 16. shadcn/Base UI Foundation

Initialize shadcn inside existing `apps/web`; never scaffold another app. Commit `components.json`
with Next.js, Base UI, TypeScript, Tailwind, CSS variables, and alias `@/components/ui`.

Use current generated Base UI shadcn APIs, not old Radix-specific composition snippets. Do not mix
primitive substrates casually. Add components only when first consumed. Candidates include Button,
Card, Input, Textarea, Label, form/field integration, Select, searchable Combobox, Dialog,
AlertDialog, DropdownMenu, Sheet, Tabs, Badge, Progress, Separator, Skeleton, Sonner, and accessible
segmented direction control.

Evaluate current shadcn Sidebar. Use only if it simplifies Cashmemo; no workspace switcher, nested
navigation, resizing, or complex collapse. A simple semantic composed nav remains acceptable. Use
one Lucide icon system; no mixed icons, emoji controls, or unlabeled critical icon-only actions.

## 17. Visual System and Thin Components

CSS-variable tokens define forest-green primary/brand, warm-neutral structure, restrained amber
accent, and separate destructive/warning/success semantics. Most surfaces stay neutral. Brand green
does not mean income; amber is not every warning. All normal/hover/focus/disabled pairs receive
contrast review. No scattered raw hex and no dark mode.

Use local system sans, deliberate heading hierarchy, tabular money, 4px spacing rhythm, practical
44px touch targets, forms near `36–40rem`, and app content near `75rem`. Cards group meaningful
content, not every row.

Thin compositions may include `PageHeader`, `EmptyState`, `QueryError`, `MoneyAmount`,
`TransactionRow`, and `StatusBadge`. They own visual composition/accessibility/display only—not
financial math, auth, recurrence, balances, budgets, duplicate API state, or hidden business rules.

## 18. Shell, Forms, and Feedback

Use one navigation vocabulary. Desktop: Overview, Transactions, Wallets, Categories, Budgets,
Recurring, Settings. Mobile: Overview, Transactions, Add, Budgets, More. Add always navigates to
`/app/transactions/new`; More opens accessible Sheet. Bottom navigation has consistent fixed height,
safe-area padding, visual separation, and matching content inset.

Deletion-only mode never mounts normal shell, financial prefetch, sidebar, bottom navigation, or
settings navigation. Authenticated HTTP/RSC/API content stays `no-store`. No financial data or
auth/session token is persisted in localStorage, sessionStorage, IndexedDB, or CacheStorage/service
worker data caches. The only browser-managed authentication credential is the server-issued
`Secure`, `HttpOnly`, `SameSite` `__Host-cashmemo_session` cookie. Logout, expiry, deletion request,
and cancellation clear private query state before navigation.

React Hook Form owns form state, Zod mirrors immediate UX validation, and Rust stays authoritative.
Labels remain visible; errors link to fields; pending state prevents duplicate submission. Desktop
actions place primary first, Cancel/Back subordinate, destructive separated. Mobile primary actions
remain tappable and reachable above keyboard/nav.

Sonner provides short confirmed feedback only. Persistent lifecycle, overspend, offline, expiry,
destructive failure, and incomplete onboarding remain page state. AlertDialog is reserved
proportionately for delete forever, hard delete, logout all, and irreversible actions. Ordinary
Trash has no confirmation. Wallet/category archive uses restrained explanatory confirmation.

## 19. Primary Flows

### 19.1 Authentication

Public pages use compact centered neutral Card, recognizable Cashmemo brand, one title, concise
copy, obvious primary action, unobtrusive links, and linked errors. Registration/resend remains
enumeration-safe and never says an account exists.

Verification/reset links use fragments:

```text
/verify-email#token=...
/reset-password#token=...
```

Fragments never reach Next.js, Traefik, normal HTTP URLs, or Rust logs. Token pages contain no
third-party content, keep restrictive `Referrer-Policy`, and persist no token to localStorage,
sessionStorage, or IndexedDB. Verification clears fragment after success. Reset may keep it in
fragment/page memory only until successful completion. No bypass endpoint exists.

### 19.2 Onboarding

Visible steps are Timezone, Currency, First wallet. Searchable Base UI Combobox offers keyboard
navigation, selected announcement, browser-detected IANA timezone first, and exact stored value.
Backend/durable completion—not frontend state machine—survives refresh, Back, archive, and deletion.
Category seeding is idempotent and not a fourth visible step.

### 19.3 Transaction create/edit

Canonical routes:

```text
create /app/transactions/new
edit   /app/transactions/{id}/edit
```

One form serves both. Order: Expense/Income, prominent amount, wallet/currency, category, local
datetime, optional note, action. One wallet is preselected; otherwise last-used active wallet when
available. Wallet determines precision. Changing wallet preserves entered string and reports error
without altering it.

### 19.4 History

Compact financial rows show explicit direction, current category/name, note, current wallet/name,
currency, Cashmemo-timezone date/time, exact amount, and Future state. Row opens edit/detail;
secondary actions move to accessible overflow on mobile.

Trash mutation removes row only after server success, then Sonner Undo calls real restore endpoint.
Pending Undo cannot duplicate. Restore invalidates affected history, wallet, month, budget, and
recent scopes. Failure leaves item in Trash and shows durable-enough error.

## 20. Dashboard and Management

Dashboard month state is shareable; per-currency summary, category percentage bars, budgets, and
month-scoped recent transactions remain independent. Partial failures and empty states are local.

Wallets use compact rows showing name, exact current/opening balance, currency, and state. One Dialog
serves create/edit. Archive confirmation explains recurrence pause/no-auto-resume. Hard delete calls
authoritative DELETE and handles 409 without frontend eligibility inference.

Categories use Expense/Income Tabs plus simple Show archived, never nested state Tabs. Provenance is
hidden. Archive uses same recurrence explanation; hard delete relies on DELETE/409.

Budgets use shareable month and currency groups. New choices show active expense categories for UX,
with Rust authoritative. Archived historical references remain understandable. Text progress may
exceed 100%; visual bar clamps only. Deletion confirmation is proportional, not account-delete
severity.

Recurring rows show direction, exact money, wallet, category, cadence, semantic local due date, and
status. Pause/Resume are direct recoverable actions. Edit copy states future-only effect and no
paused-period backfill. UI never calculates cadence.

Trash is distinct from Archive. Compact rows show transaction context, original occurrence,
`deleted_at`, and `purge_after` in configured timezone. Copy says scheduled for automatic deletion
after date, not exact-second promise. Restore invalidates financial scopes; permanent deletion of an
already-excluded trashed item normally invalidates Trash/history only.

Settings groups Preferences, Sessions/security, and Delete account. Default-currency copy states it
changes creation defaults only, never conversion/recomputation. Sign out revokes current session;
logout all revokes every session with confirmation. Both clear cookie/cache. No fingerprint, IP,
geography, or device-label expansion.

Account deletion is serious, direct, and non-manipulative. It shows Rust deadline and distinguishes
live-data purge from backup retention. Separate `/deletion` may reuse harmless UI primitives but not
AppShell/financial providers. It offers only password-confirmed cancellation and Sign out.

## 21. Targeted Invalidation

- Transaction create/edit/Trash/restore: affected history, wallet, month, category/currency budget,
  and recent scopes, including old/new scopes.
- Permanent delete from Trash: Trash/history lifecycle unless evidence shows financial inclusion.
- Opening-balance edit: wallet queries only.
- Wallet archive: wallet, recurring, entry defaults; restore: wallet/default only.
- Category archive: category and recurring; restore: category only.
- Timezone change: profile/preferences, transaction entry defaults, transaction/history display,
  monthly dashboard summary, budget/current-month views, month-scoped recent transactions, and any
  mounted form whose displayed local datetime depends on timezone. Recurrence persistence is never
  rewritten.
- Default currency: preferences and new-resource defaults only.

Authoritative financial totals are never invented optimistically.

## 22. Accessibility and Slice Completion

Every UI slice must verify real hierarchy, realistic content, loading, empty, API-error, validation,
and success states; mobile and desktop layouts; keyboard use; visible focus; overlay trap/restoration;
accessible names; linked errors; non-color-only meaning; proportional destructive behavior; reduced
motion; contrast; and no duplicated business rule.

Skeletons stabilize meaningful regions without pixel-perfect ghosts. Motion never carries meaning.
The final audit adds 200% zoom, text enlargement where practical, no horizontal overflow, sticky-nav
focus visibility, small-height overlay fit, and virtual-keyboard action reachability.

## 23. Test Strategy

Real PostgreSQL tests cover ownership, auth/deletion transactions, datetime conversion, boundaries,
recurrence/idempotency, opening balance/report separation, receipt replay, readiness, and corrupt
money. Pure parser/arithmetic/formatter behavior may use unit tests.

Required regressions include cancellation password/session behavior; browser/profile timezone
mismatch; history/report boundary agreement; Jan-31, Jan-30, Feb-29, weekly and long-pause anchors;
opening-balance balance-only effect; exact receipt key version; proxy parser and HTTP topology;
readiness target states; request-ID consistency; and corrupt-scale errors.

Trusted-proxy HTTP tests include direct spoof ignored, trusted chain resolved, malformed/excessive
metadata rejected safely, two real clients behind one proxy receiving distinct buckets, and the
production-like case where an attacker supplies a malformed/spoofed left-side XFF prefix while
trusted Traefik sanitizes or appends the actual remote address. Rust must still resolve the actual
remote without parsing the hostile prefix or collapsing unrelated users into the proxy bucket.

Migration tests apply the additive onboarding migration to a qualifying existing V1 account and
prove `onboarding_completed_at` is backfilled and onboarding does not reopen.

Vitest/RTL covers forms, rendering, invalidation, restricted shell, exact-safe display, and UI
states. Playwright stays high-value: fragment auth, onboarding, transaction cross-timezone, history,
Trash/Undo, opening balance, representative budgets/recurring, deletion shell/cancellation, and
session/cache/privacy transitions. Detailed math/calendar permutations remain Rust/Vitest.

Cross-timezone browser proof:

```text
browser:  America/Los_Angeles
profile:  Asia/Jakarta
input:    2026-08-31T23:30
stored:   2026-08-31T16:30:00Z
display:  2026-08-31T23:30
```

Fragment tests prove token absent from HTTP URL/logs/persistent storage and cleared after success.
Browser privacy tests inspect localStorage, sessionStorage, IndexedDB, CacheStorage, restricted-mode
financial requests, and observable private state after transitions. Small axe checks supplement,
never replace, manual behavioral review.

### 23.1 Previous test-gap audit

- Deletion tests covered request/claim races but not cancel-then-reuse of a restricted token.
- Transaction tests accepted canonical UTC input and did not run browser timezone different from
  profile timezone.
- History frontend tests encoded UTC boundaries instead of asserting user-calendar semantics.
- Recurrence tests covered processing/idempotency but not resume after clamped monthly/yearly dates.
- Wallet tests asserted opening-balance immutability despite approved editable behavior.
- Receipt tests covered valid multiple versions but not declared-version/HMAC mismatch.
- Rate-limit tests covered direct peer/identifier behavior but not trusted reverse-proxy topology.
- Readiness tests covered reachability/failure but not schema identity and exact migration state.
- Request-ID tests did not compare auth error body with response header.
- Money tests used valid-scale fixtures and did not inject corrupt persisted scale.
- Recovery Bats were exercised on BSD/macOS tools without GNU portability coverage.
- Dependency audit checked application packages, not vulnerability contents of built web image.

Each corrected or added test names the production behavior that would make it fail. Wrong baseline
expectations receive the four-field change record from Section 4.

## 24. Portable Recovery Tests

Create deterministic helper:

```text
scripts/operations/utc-timestamp.mjs --base <RFC3339> --offset-seconds <N>
scripts/operations/utc-timestamp.mjs --now --offset-seconds <N>
```

Tests always use fixed base. Example:

```text
2026-08-25T00:00:00Z + 600
→ 2026-08-25T00:10:00Z
```

It emits strict UTC RFC3339 without milliseconds and rejects invalid/conflicting arguments. Bats
replace BSD `date -v` without weakening preservation or restore assertions.

## 25. Web-container Repair

Use current patched official Node 24 Bookworm-slim base pinned by immutable digest. Keep runtime
packages minimal. Do not use blanket `apt-get upgrade`. If pinned base still has a fixable package,
narrowly upgrade that package and document it.

Next standalone needs Node, not npm/npx/Corepack. Remove those through a deliberate tested step tied
to known official-image paths, not arbitrary filesystem purge. Evidence proves Node starts app,
health/app request succeeds, package-manager commands are absent, process is non-root, base and built
digests are recorded, and Trivy is clean under:

```text
severity: CRITICAL,HIGH
ignore-unfixed: true
exit-code: 1
vuln-type: os,library
```

No undocumented suppression. Any future exception needs exact CVE, applicability rationale, and
expiry/review condition; none is planned here.

## 26. Visual Review

Use fixed viewports:

```text
375 × 812
768 × 1024
1280 × 800
1440 × 900
```

Capture and inspect login, onboarding, dashboard, new transaction, history/filters, wallets,
budgets, recurring, and settings/account deletion at each viewport, including a long scrolling
state.

Use realistic synthetic density: long names, large IDR amounts, several currencies, negative
remaining budget, progress above 100%, long note, archived state, future transaction, crowded
history, and validation errors. Review hierarchy, density, wrapping, truncation, overflow, financial
emphasis, empty space, and CRUD appearance. Screenshots are human evidence, not pixel snapshot gates.

Screenshots, traces, videos, logs, and network metadata use synthetic users/data only and never
production. CI artifacts have bounded retention and controlled access. Synthetic tokens may appear
in disposable traces; real credentials never do.

## 27. Final Local Verification

Begin with tracked tree clean, no stale generated diff/services/test DB/volumes, and user-owned
`.serena/` untouched/reported. Start fresh disposable PostgreSQL, Mailpit, and S3-compatible receipt
storage.

Run pinned toolchain checks and all Rust fmt/Clippy/tests/PostgreSQL/release-S3, frontend lint,
typecheck, Vitest, build, OpenAPI/Orval drift, Playwright, migration safety, preservation/recovery,
dependency audit, API/web Docker+Trivy, canonical-layout, and `git diff --check` gates. Clean
disposable services/volumes afterward.

Evidence records exact commands, versions, results, feature SHA, target SHA, and image digests.
Rust evidence uses repository-pinned 1.97.1 unless a separately reviewed toolchain change occurs.

## 28. Hosted Integration Gate

After local green:

1. push `rewrite/cashmemo-v1` without force;
2. confirm remote feature SHA equals local SHA;
3. record current `main` SHA;
4. keep PR #3 draft;
5. run required pull-request CI;
6. record PR head and GitHub-tested merge-result SHA/ref;
7. require every job green;
8. repair failures via systematic debugging/TDD and repeat on new exact identities.

A PR merge-result proves integration against its recorded base, not isolated head. If `main` moves,
mergeability, diff, merge-result CI, and relevant review evidence become stale and must repeat.

Required hosted jobs include Rust fmt/Clippy/PostgreSQL/release-S3, frontend lint, typecheck, Vitest,
build, OpenAPI/Orval, real-stack Playwright, migration safety, preservation/recovery, dependency
audit, and both Docker/Trivy jobs.

## 29. Independent Review

After hosted integration green, independent review uses two views:

```text
A. e59bf67c59dc0c31ffb3fef3b56f68bea4331f10...repaired-head
   finding coverage and collateral regression

B. exact-current-main...repaired-head plus tested merge result
   full V1 merge readiness
```

Review emphasizes auth/session lifecycle, ownership, money, timezone, recurrence, data lifecycle,
migration protection, caching/privacy, generated API, CI/infrastructure, UI shell, accessibility,
and original PR Task 26 changes—especially executable-configuration commit `b2c89dc` and
whitespace/configuration commit `d9171ec`. “Task 26” here refers to original PR implementation work,
not Section 26 (Visual Review) of this repair specification. Controller verifies findings
independently.

Any unresolved required finding returns to repair and CI. Only resolved findings plus current-target
green evidence permits `READY FOR HUMAN MERGE REVIEW`.

## 30. Evidence Semantics and Final State

Evidence distinguishes local disposable capability, hosted repository/integration CI, and actual
production readiness. Local MinIO replay does not prove production backup freshness, receipt-store
configuration, or restore. Production stays `NOT READY`.

```text
required test/CI failure
OR unresolved independent finding
OR stale current-main integration evidence
→ REQUEST CHANGES / NOT MERGE READY

all required gates green
+ findings resolved
+ exact current target verified
→ READY FOR HUMAN MERGE REVIEW
```

“Mostly green,” local equivalents, and unexplained unrelated failures are not merge-ready evidence.
The task may update PR evidence and recommend review, but cannot merge, deploy, mutate Dokploy,
access/change production PostgreSQL, run production migrations, change routes, cut over, or perform
destructive production action.

## 31. Material Decisions

All material product, security, API, UI-foundation, test, and merge-gate decisions required for the
repair are resolved in this specification. Exact dependency versions, patched base digest, built
image digest, and generated artifact hashes are measured and recorded during implementation; they
are verification outputs rather than unresolved product decisions.
