# Feature Specification: Cashmemo MVP

**Feature Branch**: `001-cashmemo-mvp`

**Created**: 2026-08-09

**Status**: Specified — clarified and verified for planning approval

**Input**: Create the first production-usable Cashmemo MVP: a privacy-first money journal for
capturing, organizing, reviewing, understanding, exporting, and deleting money events without bank
connections.

## Product Intent and Scope

Cashmemo remembers money activity, context, and decisions rather than bank accounts. Its primary
domain object is a **Money Memo**: one user-owned income or expense event with an amount, currency,
occurrence time, and optional organizational or contextual details.

Feature 001 must let a new user establish a private journal, record and manage Money Memos manually,
use optional natural-language or voice assistance, understand current and historical activity, and
exercise meaningful export and deletion rights. Manual journaling is the product; speech-to-text
(STT) and AI extraction are accelerators that may fail without blocking manual use.

Money Spaces organize context such as Personal, Work, Household, Freelance, Travel, or Project.
They are labels, never financial accounts or representations of balances.

### Guarantee Classification

| Class | Feature 001 meaning |
|-------|---------------------|
| Hard product invariant | Cashmemo never solicits or provides dedicated fields for prohibited banking data; every confirmed record belongs to exactly one authenticated user; AI/STT output remains an editable draft until explicit confirmation; currencies are never combined; sensitive financial values never enter diagnostics. |
| Best-effort control | Detection and blocking of prohibited data embedded in arbitrary user-authored text or speech-derived text uses documented, testable controls but cannot claim complete semantic detection. |
| Operational SLO | Availability, response-time, purge, backup, and restore targets are measurable operating objectives, not claims that failures are impossible. |
| Provider dependency | STT and AI completion time, accuracy, provider-side erasure, and provider availability depend on approved third parties and must be disclosed and monitored. |
| Known limitation | AI interpretation can be incomplete or wrong; arbitrary-text privacy detection has false positives and false negatives; network loss permits draft recovery but not general offline synchronization; no currency conversion or cross-currency valuation exists. |

## Clarifications

### Session 2026-08-09

- Q: How should Cashmemo reconcile arbitrary natural-language text and voice with Constitution
  1.0.0's universal sensitive-input rejection rule? → A: Amend the constitution through a separate
  governance action. Constitution 2.0.0 now prohibits intentional or dedicated collection,
  mandates defined behavior for supported finite detector matches, treats arbitrary-language
  semantic detection as best effort, isolates candidate and detector material from diagnostics and
  unrelated provider requests, and requires user guidance. Feature 001 has no exception.
- Q: Which production authentication and account-recovery method should Feature 001 use? → A:
  Verified email and password signup/login with single-use password reset and persistent,
  revocable sessions.
- Q: What maximum duration should Feature 001 allow for one voice recording? → A: 60 seconds.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start a Private Money Journal (Priority: P1)

A new user can create or access an account, understand what Cashmemo does and does not collect, set
basic preferences, and arrive at an understandable empty journal ready for first use.

**Why this priority**: No protected journal capability is usable until identity, privacy expectations,
and reporting defaults are established.

**Independent Test**: Starting with no account, complete account access and onboarding, verify the
privacy explanation and saved preferences, sign out, restore the session or sign back in, and reach
the new-user journal without using any other story.

**Acceptance Scenarios**:

1. **Given** a visitor with no account, **When** they sign up with email and password and verify the email address, **Then** they receive a private account and begin onboarding without entering financial or banking credentials.
2. **Given** a returning user with a valid session, **When** they reopen Cashmemo, **Then** the session is restored and only their journal is accessible.
3. **Given** an expired, revoked, or invalid session, **When** protected content is requested, **Then** access fails closed, no journal data is disclosed, and reauthentication is requested.
4. **Given** a first-time user, **When** onboarding is shown, **Then** it explains the no-bank-connection model, temporary voice processing, AI draft status, and export/deletion rights before requesting default currency, reporting timezone, and locale preferences.
5. **Given** completed onboarding with no Money Memos, **When** the journal opens, **Then** it presents a useful empty state with manual, natural-language, and voice capture choices and no invented totals.
6. **Given** an authenticated user, **When** they sign out, **Then** the local session ends and protected screens no longer reveal journal content.
7. **Given** a user who cannot authenticate with their password, **When** they request and complete a valid single-use password-reset flow, **Then** the password changes, all existing sessions are revoked, and they can authenticate again without account-existence disclosure from the request response.

**Degraded/failure behavior**: Authentication or persistence outage blocks protected account access
with an explicit service-unavailable state; it never falls back to an anonymous or shared journal.
Completed preference input is preserved as a recoverable draft when safe to do so.

**Privacy implications**: Onboarding must not request bank details. Authentication diagnostics may
identify the operation and opaque account identifier but never credentials, journal content, or
preference values.

**Completion criteria**: Production-equivalent evidence covers signup, verification, login, logout,
session restoration, invalid-session denial, onboarding persistence, and cross-user isolation.

---

### User Story 2 - Keep an Accurate Manual Money Journal (Priority: P1)

A user can capture an income or expense manually, preserve work through retryable failures, find it
in history, correct it safely, archive or restore it, and move it through a transparent deletion
lifecycle.

**Why this priority**: Reliable manual journaling delivers Cashmemo's core value without depending on
voice or AI.

**Independent Test**: With one authenticated test user and no STT or AI service, create, retry, view,
edit, archive, restore, delete, recover, and permanently purge one Money Memo while verifying another
user cannot access it.

**Acceptance Scenarios**:

1. **Given** a user entering a positive amount, direction, supported currency, and occurrence time, **When** they explicitly save, **Then** exactly one confirmed Money Memo appears in history.
2. **Given** a create request whose response is lost, **When** the identical request is retried with the same retry identity, **Then** the original Money Memo is returned and no duplicate is created.
3. **Given** an interrupted create or edit, **When** the user returns on the same supported device, **Then** recoverable draft input is offered without being presented as confirmed.
4. **Given** a confirmed Money Memo, **When** its current revision is edited, **Then** the changed authoritative values appear in history and deterministic summaries.
5. **Given** a stale edit, **When** a newer revision already exists, **Then** the stale write is rejected and the user can reload the current record before reapplying changes.
6. **Given** an archived Money Memo, **When** default history is viewed, **Then** it is hidden from the default list but remains included in financial totals and can be found with the archived filter.
7. **Given** a Money Memo in Recently Deleted, **When** it is restored before expiry, **Then** its prior archived or active state and authoritative values return.
8. **Given** a Money Memo selected for immediate permanent purge, **When** the user completes destructive confirmation, **Then** it becomes inaccessible and enters the defined irreversible purge process.

**Degraded/failure behavior**: STT, AI, analytics, monitoring export, and other accelerator outages do
not block this story. Network loss preserves an unconfirmed draft but does not claim a server-confirmed
save until acknowledgment arrives.

**Privacy implications**: Every operation verifies authenticated ownership. Amounts, notes, labels,
and validation input remain absent from diagnostics and error text.

**Completion criteria**: Tests prove positive/zero/negative boundaries, exact monetary behavior,
idempotent retry, revision conflict, draft recovery, state transitions, purge initiation, and denial
for a second authenticated user.

---

### User Story 3 - Turn Words or Voice into a Reviewed Draft (Priority: P1)

A user may describe money activity naturally by typing or speaking. Cashmemo converts available input
into an editable structured draft, makes uncertainty visible, and requires explicit confirmation
before creating an authoritative Money Memo.

**Why this priority**: Fast contextual capture differentiates Cashmemo while user confirmation protects
financial truth.

**Independent Test**: For both typed text and a voice recording, produce a structured draft, edit every
field, reject ambiguous or invalid output safely, confirm once, and prove temporary audio deletion on
all required paths.

**Acceptance Scenarios**:

1. **Given** the user's default currency is IDR and they enter “Spent 85 thousand for lunch with a client today, work expense,” **When** extraction succeeds, **Then** an editable expense draft is shown with amount, IDR currency, occurrence date, suggested category, Work Money Space, and contextual note, with no confirmed record yet.
2. **Given** a voice recording no longer than 60 seconds, **When** STT and extraction succeed, **Then** the transcript and structured fields are reviewable and editable before confirmation.
3. **Given** an ambiguous or low-confidence result, **When** the draft appears, **Then** uncertain or missing fields are visibly identified and cannot be silently filled with authoritative values.
4. **Given** malformed, contradictory, or schema-invalid AI output, **When** validation runs, **Then** that output is rejected, the original recoverable text or transcript remains available where permitted, and manual completion is offered.
5. **Given** a reviewed assisted draft, **When** the user changes any extracted field and confirms, **Then** only the user-edited values become the confirmed Money Memo.
6. **Given** a completed transcription, cancellation, unrecoverable failure, or retention expiry, **When** the applicable audio lifecycle event occurs, **Then** raw audio is deleted and automated evidence proves the path.
7. **Given** a prohibited-data warning or block in typed or transcribed text, **When** the user corrects or discards the input, **Then** prohibited content is not intentionally persisted as a confirmed record or emitted to diagnostics.
8. **Given** an active voice recording, **When** it reaches 60 seconds, **Then** recording stops automatically, the user sees that the limit was reached, and no further audio is captured.

**Degraded/failure behavior**: If STT fails, audio is deleted and manual text entry remains available.
If extraction fails after transcription, the editable transcript may seed a manual draft. A recording
or network interruption never confirms a partial result.

**Privacy implications**: Recording requires explicit initiation and an active temporary-audio notice.
Providers must be approved for no training and acceptable retention. Raw audio, transcript content,
and extracted financial values never enter diagnostics.

**Completion criteria**: Production-equivalent STT and AI evidence covers success, ambiguity, invalid
output, user edits, single confirmation, cancellation, interruption, provider failure, and every
audio deletion trigger.

---

### User Story 4 - Understand the Current Month at a Glance (Priority: P1)

A user can see a compact, deterministic view of current-month income, expenses, net movement, recent
Money Memos, category spending, planned versus unplanned activity, and purpose where useful.

**Why this priority**: Regular value comes from understanding recorded activity, not merely storing it.

**Independent Test**: Seed confirmed Money Memos across dates, states, purposes, categories, and at
least two currencies; verify all current-month values and boundaries without using monthly review or
AI narrative.

**Acceptance Scenarios**:

1. **Given** current-month IDR Money Memos, **When** overview opens, **Then** income, expenses, and net movement equal deterministic sums of eligible confirmed records.
2. **Given** both IDR and USD Money Memos, **When** overview opens, **Then** each currency has separate totals and no combined valuation is displayed or implied.
3. **Given** categorized, uncategorized, planned, unplanned, and unspecified records, **When** breakdowns appear, **Then** every eligible amount belongs to exactly one visible bucket per dimension.
4. **Given** activity near a month or daylight-saving boundary, **When** overview is calculated, **Then** membership follows the user's reporting timezone rules consistently.
5. **Given** no eligible current-month records, **When** overview opens, **Then** a zero/empty state is shown without fabricated trends or category rankings.

**Degraded/failure behavior**: When summary calculation cannot complete, stale or partial totals are not
silently presented as current. Capture remains available and the unavailable overview is named.

**Privacy implications**: Financial aggregates and category details are protected journal content and
must not appear in telemetry, URLs, push content, or unauthenticated caches.

**Completion criteria**: Deterministic fixtures prove eligibility, arithmetic, timezone boundaries,
state inclusion, tie-breaking, empty state, and strict per-currency separation.

---

### User Story 5 - Continue Safely Through Service and Network Failures (Priority: P1)

A user can keep manual work recoverable and understand unavailable capabilities when STT, AI,
monitoring export, another external provider, or the network fails.

**Why this priority**: A production money journal cannot let an accelerator outage or lost response
silently lose, duplicate, or corrupt user work.

**Independent Test**: Disable each accelerator independently, interrupt network operations at defined
points, and verify manual capture and confirmed records remain safe while affected capabilities show
explicit degraded states.

**Acceptance Scenarios**:

1. **Given** STT or AI is unavailable, **When** the user opens capture, **Then** structured manual entry remains usable and the unavailable accelerator is named.
2. **Given** a network interruption before confirmation acknowledgment, **When** connection returns, **Then** the draft can resume and retry without duplicate creation.
3. **Given** a provider timeout after partial processing, **When** the flow ends, **Then** no partial Money Memo becomes confirmed and retained input follows its declared lifecycle.
4. **Given** diagnostic export is unavailable, **When** core journal operations run, **Then** user operations are not blocked and telemetry is safely dropped or buffered without financial content.
5. **Given** a persistence or authentication outage, **When** a protected mutation is attempted, **Then** it fails explicitly rather than writing to an unsafe local authoritative store.

**Degraded/failure behavior**: General offline synchronization is not offered. Network-unavailable users
may preserve an unconfirmed same-device draft, but server-dependent viewing, confirmation, export,
and deletion wait for connectivity.

**Privacy implications**: Recovery stores only declared draft data, uses the shortest defined lifetime,
and never converts sensitive diagnostic payloads into a fallback queue.

**Completion criteria**: Fault-injection evidence covers lost requests, lost responses, provider
timeouts, invalid output, safe retry, explicit degradation, draft recovery, and unchanged confirmed
records.

---

### User Story 6 - Organize and Find Money Activity (Priority: P2)

A user can use categories and Money Spaces, then search and filter history by meaningful dimensions
without treating organizational labels as accounts.

**Why this priority**: Organization makes a growing journal usable after core capture is reliable.

**Independent Test**: Create and manage labels, assign them to Money Memos, and find exact subsets by
search, date range, direction, category, Money Space, purpose, plan status, record state, and currency.

**Acceptance Scenarios**:

1. **Given** a new account, **When** onboarding finishes, **Then** starter categories and Money Spaces are available without representing balances or bank accounts.
2. **Given** user-created labels, **When** they are renamed or deactivated, **Then** historical Money Memos retain understandable associations and inactive labels cannot be selected for new records unless restored.
3. **Given** a populated journal, **When** filters are combined, **Then** only records satisfying all selected filters appear and active filters are visible and removable.
4. **Given** note or label search text, **When** search completes, **Then** matches are account-scoped and search input is absent from diagnostics.
5. **Given** no matching records, **When** search or filters complete, **Then** a clear no-results state preserves the active criteria and offers reset.
6. **Given** a user continues a multi-page history traversal after a create, purge, restore, archive-state change, or occurrence-time edit changed possible membership or ordering, **When** the continuation is submitted, **Then** Cashmemo returns a stable results-changed outcome and requires a refreshed traversal instead of returning a page that could imply completeness.

**Degraded/failure behavior**: Search or label failure does not alter confirmed records. Failed label
changes preserve user input and disclose no other user's names.

**Privacy implications**: Category, Money Space, and search text may contain sensitive context and
receive the same input-boundary and diagnostic protections as Money Memo notes.

**Completion criteria**: Tests cover starter data, custom lifecycle, combined filters, archived and
deleted state behavior, empty results, traversal-version invalidation, and cross-user isolation.

---

### User Story 7 - Review a Month Deterministically (Priority: P2)

A user can select a month and understand per-currency totals, largest expense categories, unplanned
activity, and comparison with the prior calendar month.

**Why this priority**: A consistent review turns journal history into decisions without relying on
unverifiable AI financial calculation.

**Independent Test**: Populate two adjacent months in multiple currencies and verify the review,
rankings, comparison rules, zero-baseline handling, and timezone boundaries using deterministic data.

**Acceptance Scenarios**:

1. **Given** a selected month with multiple currencies, **When** review opens, **Then** each currency shows separate income, expenses, net movement, rankings, unplanned amount, and prior-month comparison.
2. **Given** equal category totals, **When** largest spending is ranked, **Then** deterministic tie-breaking produces the same order on every run.
3. **Given** zero prior-month expenses, **When** comparison is calculated, **Then** no undefined percentage is shown and an absolute-change explanation is used.
4. **Given** a month with no activity in one currency, **When** review opens, **Then** that empty currency section is omitted unless the user explicitly filters to it.
5. **Given** assisted capture metadata, **When** review is calculated, **Then** only user-confirmed Money Memo values affect financial results.

**Degraded/failure behavior**: A failed review calculation shows no partial totals as complete. The
journal and manual capture remain usable.

**Privacy implications**: Review values remain protected content. MVP review contains no AI-authored
financial narrative; any later narrative requires separate labeling and specification.

**Completion criteria**: Golden deterministic datasets prove arithmetic, eligibility, rankings,
comparisons, month boundaries, empty states, and currency separation.

---

### User Story 8 - Export and Permanently Delete My Data (Priority: P2)

A user can obtain a machine-readable copy of their account data and can delete individual records or
the entire account through explicit, understandable, and testable lifecycle stages.

**Why this priority**: Data ownership is part of Cashmemo's privacy promise, not a post-MVP add-on.

**Independent Test**: Export a populated account, validate completeness, delete and restore one record,
purge another, request account deletion, cancel within the grace period, repeat through irreversible
purge, and prove access denial and lifecycle evidence.

**Acceptance Scenarios**:

1. **Given** a populated account, **When** export is requested and reauthenticated, **Then** a documented machine-readable package includes active and archived Money Memos, recoverable drafts, organizational labels, preferences, and relevant lifecycle metadata separated by currency.
2. **Given** an export package, **When** its limited download lifetime expires, **Then** the package becomes unavailable and is deleted according to the export lifecycle.
3. **Given** a deleted Money Memo within its recovery window, **When** Recently Deleted is opened, **Then** remaining time, restore, and immediate permanent purge choices are clear.
4. **Given** an account-deletion request, **When** destructive confirmation and reauthentication complete, **Then** the account enters a visible grace period, normal access is suspended, and cancellation remains possible only during that period.
5. **Given** an expired account-deletion grace period, **When** purge completes, **Then** live account data is inaccessible, provider deletion is requested, backup expiry limits are disclosed, and the account cannot be restored from operational backups.

**Degraded/failure behavior**: Export or deletion failure is explicit and retryable without creating
duplicate exports or contradictory deletion states. Account purge cannot be reported complete while a
required live-store or provider deletion step is unresolved.

**Privacy implications**: Export is a high-risk disclosure requiring recent authentication and a
short-lived delivery channel. Deletion evidence uses opaque identifiers and lifecycle states, never
deleted financial content.

**Completion criteria**: Production-equivalent evidence proves export schema/completeness, secure
delivery expiry, record recovery/purge, account grace/cancellation/purge, provider requests, backup
expiry, and post-purge denial.

### Edge Cases

- A zero, negative, sign-prefixed, non-finite, over-precision, unsupported-currency, or excessively large amount is rejected without changing existing data.
- Income/expense direction remains separate from positive amount magnitude; changing direction never negates the amount.
- A retry key reused with different content is rejected as a conflict rather than returning or creating an unrelated record.
- Two tabs edit the same Money Memo; only the write based on the current revision succeeds.
- An occurrence time falls in a daylight-saving gap or repeated hour; the user must see the resolved local time and timezone offset before confirmation.
- A reporting-timezone change can move boundary-adjacent records between periods; the user is warned and all affected views recalculate consistently.
- Relative terms such as “today” or “last night” resolve from the capture start time in the reporting timezone and remain editable.
- AI returns an unsupported currency, negative amount, contradictory direction, future occurrence, unknown label, extra field, or executable content; invalid values are discarded or surfaced for manual correction.
- STT succeeds but AI fails; transcript recovery never confirms a Money Memo.
- Recording permission is denied, revoked mid-recording, or interrupted by a call or browser suspension.
- Audio upload completes but response is lost; lifecycle enforcement still expires raw audio and safe retry cannot create duplicate confirmation.
- The same voice or text draft is confirmed twice; confirmation identity yields one Money Memo.
- A user closes the application during capture, extraction, confirmation, export generation, or deletion.
- An archived record is deleted and later restored; it returns to archived state rather than active state.
- A category or Money Space in use is deactivated, renamed, restored, or targeted for permanent deletion.
- Search text contains prohibited-data candidates, Unicode confusables, very long input, markup, or control characters.
- Filters specify an invalid range, a range crossing timezone changes, no matching values, or mutually exclusive states.
- Monthly comparison has no prior period, zero prior value, negative net movement, refunds, equal category totals, or records in many currencies.
- Recently Deleted expiry races with a restore request; exactly one terminal result is returned and disclosed.
- Account purge races with export generation, active sessions, or record restoration; deletion state wins and protected operations fail closed.
- Provider deletion confirmation is delayed or unavailable; Cashmemo reports pending operational status rather than claiming completion.
- Backup restoration is required after an individual Money Memo purge or account deletion; scope-specific suppression tokens exclude the exact restored memo or account identity and re-purge it before service resumes.
- Monitoring, analytics, or crash handling receives an exception containing user input; sensitive fields are removed before emission.
- A user has more history than can be displayed at once; each traversal binds its continuation cursor to a result-set version and canonical query/filter state, and any list-affecting change returns `RESULTS_CHANGED` so the user refreshes rather than continuing an obsolete traversal. Purged or inaccessible data is never returned for cursor continuity.
- A PWA update occurs while a draft exists; the draft remains recoverable or the user receives explicit loss-risk notice before update.

## Requirements *(mandatory)*

### Functional Requirements

#### Account, Session, and Onboarding

- **FR-001**: Cashmemo MUST support signup and login with a unique verified email address and password; protected journal use MUST remain unavailable until email verification succeeds. Password recovery MUST use a time-limited, single-use reset action, return an account-enumeration-safe request response, and revoke all existing sessions when completed.
- **FR-002**: Cashmemo MUST use persistent revocable sessions that restore across PWA restarts on the same device, expire after no more than seven days of inactivity or 30 days absolute age, rotate session security material as appropriate, and fail closed after expiry, revocation, password reset, or invalidation.
- **FR-003**: Users MUST be able to sign out from the current session and revoke all other active sessions.
- **FR-004**: Onboarding MUST explain that Cashmemo records money events, does not connect to banks, does not request prohibited banking data, uses temporary audio, treats AI/STT output as drafts, and provides export/deletion rights.
- **FR-005**: Onboarding MUST collect default currency, reporting timezone, and locale preferences; each preference MUST remain editable later. Preference updates MUST require the current revision and reject stale writes without silently overwriting newer values.
- **FR-006**: Default currency MUST accelerate entry but MUST be overridable on every Money Memo.
- **FR-007**: A new account MUST receive a useful empty state and starter organizational labels without fabricated financial data.
- **FR-008**: Account and session errors MUST disclose no account existence, journal data, or other user's information beyond what the selected identity flow safely requires.
- **FR-009**: Authentication, onboarding, and preference mutations MUST be idempotent where client or provider retries can repeat them.
- **FR-010**: Every protected read, write, export, and deletion operation MUST derive ownership from the authenticated principal rather than client-supplied ownership fields.

#### Money Memo Semantics and Lifecycle

- **FR-011**: A confirmed Money Memo MUST belong to exactly one user and MUST contain direction (`income` or `expense`), positive amount magnitude, supported currency, occurrence instant, occurrence timezone, lifecycle state, creation time, update time, and revision.
- **FR-012**: Category, Money Space, purpose (`personal`, `work`, `mixed`, or unspecified), planning status (`planned`, `unplanned`, or unspecified), and note/context MUST be optional Money Memo attributes.
- **FR-013**: Amount MUST be greater than zero, MUST NOT use a sign to encode direction, MUST respect the selected currency's minor-unit precision, and MUST contain no more than 15 significant decimal digits.
- **FR-014**: Cashmemo MUST reject zero, negative, non-finite, unsupported, over-precision, or out-of-range monetary input before confirmation.
- **FR-015**: Supported currencies MUST be identified by canonical currency codes and declared minor-unit rules from a versioned supported-currency registry.
- **FR-016**: Each Money Memo MAY use any supported currency regardless of account default.
- **FR-017**: Cashmemo MUST NOT perform currency conversion or display consolidated values, rankings, charts, comparisons, or summaries across currencies.
- **FR-018**: Occurrence MUST represent an instant plus the timezone used to interpret user input; ambiguous or nonexistent local times MUST be resolved visibly before confirmation.
- **FR-019**: Relative dates in assisted capture MUST resolve from capture-start time in the user's reporting timezone and MUST remain editable.
- **FR-020**: Occurrence times more than five minutes in the future MUST require correction because Feature 001 records occurred money events, not scheduled transactions.
- **FR-021**: Current-month and monthly-review boundaries MUST use the user's current reporting timezone; changing that timezone MUST warn that boundary-adjacent records may move between periods and MUST recalculate every affected view consistently.
- **FR-022**: Confirmed Money Memos MUST support view, edit, archive, restore, move to Recently Deleted, restore from Recently Deleted, and immediate permanent-purge request.
- **FR-023**: Edits MUST require the current revision; stale writes MUST be rejected with current-state reload guidance and MUST NOT silently merge or overwrite.
- **FR-024**: A successful edit MUST replace authoritative values without retaining obsolete financial values as user-visible history in Feature 001; security audit metadata MUST remain content-free.
- **FR-025**: Archive MUST hide a record from default history but MUST retain it in deterministic financial aggregates until deletion.
- **FR-026**: Recently Deleted records MUST be excluded from history, search, aggregates, and reviews except the dedicated recovery view.
- **FR-027**: Record deletion MUST preserve the prior active/archived state for restoration during a 30-day recovery window.
- **FR-028**: Expired or immediately purged records MUST be removed from live user access within 24 hours and MUST never be restored from operational backup recovery.
- **FR-029**: Create and confirmation requests MUST use caller-generated retry identity; identical retries MUST yield one record, while reuse with different content MUST fail as conflict.
- **FR-030**: History and recovery-list traversal MUST use occurrence time followed by an immutable tie-breaker and MUST bind every continuation cursor to a server-issued result-set version plus canonical query/filter state. Create, deletion, restore, archive-state membership change, occurrence-time edit, or any other mutation that can change that traversal's membership or ordering MUST invalidate the prior version; an obsolete or query-mismatched continuation MUST return a stable `RESULTS_CHANGED` outcome requiring refresh rather than claim a complete traversal. Non-membership/non-order edits MAY preserve the version. Purged or inaccessible data MUST NOT be returned to satisfy an old cursor, and no long-lived database snapshot across browser requests is required.

#### Drafts, Natural Language, Voice, STT, and AI

- **FR-031**: Structured manual entry MUST remain fully usable without STT, AI, analytics, or optional provider availability.
- **FR-032**: Typed natural-language capture MAY propose a structured draft but MUST NOT create a confirmed Money Memo without explicit user confirmation.
- **FR-033**: Voice capture MUST follow: explicit recording start → temporary audio → STT → editable transcript → validated AI extraction → editable structured draft → explicit confirmation → confirmed Money Memo.
- **FR-034**: Every AI/STT-populated field MUST be editable, and uncertain, missing, contradictory, or inferred values MUST be visibly distinguished before confirmation.
- **FR-035**: Amount, direction, currency, and occurrence time MUST satisfy the same validation rules regardless of manual or assisted origin.
- **FR-036**: Invalid or unexpected provider output MUST be rejected at the trust boundary, MUST NOT reach domain calculation, and MUST NOT be silently coerced into authoritative data.
- **FR-037**: If STT succeeds and extraction fails, the transcript MAY remain in the recoverable draft so the user can complete structured fields manually.
- **FR-038**: If STT fails, Cashmemo MUST delete raw audio according to the failure lifecycle, explain the unavailable result, and offer manual text entry or a new recording.
- **FR-039**: AI/STT MUST never overwrite, reclassify, or enrich an already confirmed Money Memo without a new explicit user edit.
- **FR-040**: Drafts MUST be represented separately from confirmed records and MUST never affect history totals, search results, summaries, rankings, exports of confirmed records, or reviews unless the export explicitly identifies them as drafts.
- **FR-041**: Recoverable manual, text, transcript, and structured drafts MUST expire seven days after last user activity, MUST be discardable immediately, and MUST be removed within 24 hours of expiry, confirmation, or discard. Draft updates MUST require the current revision; a stale-write rejection MUST preserve the user's conflicting local input for explicit resolution rather than silently overwriting either version.
- **FR-042**: Derived AI metadata not chosen as a confirmed field MUST be deleted within 24 hours of confirmation, discard, unrecoverable failure, or draft expiry.
- **FR-043**: A voice recording MUST stop automatically at 60 seconds, MUST show elapsed and remaining time while recording, and MUST visibly disclose when the limit stops capture.
- **FR-044**: Raw audio MUST be deleted after successful transcription, user cancellation, unrecoverable failure, or a maximum retention expiry of one hour, whichever occurs first.
- **FR-045**: Audio lifecycle ownership MUST enforce deletion independently of callers and MUST include automated evidence for all four constitutional deletion paths.
- **FR-046**: Recording or network interruption MUST never confirm partial output; any retained transcript or draft MUST be labeled incomplete and follow declared retention.
- **FR-047**: Assisted-draft confirmation MUST be idempotent so repeated confirmation yields exactly one Money Memo.
- **FR-048**: Capture MUST preserve the user's byte-equivalent recoverable text where safe while validation is unresolved; normalization used for parsing MUST NOT silently replace displayed input.
- **FR-049**: User-facing provider failure messages MUST name the unavailable capability without exposing prompts, transcript content, provider payloads, or internal diagnostics.
- **FR-050**: Cashmemo MUST show explicit consent/context before sending audio, transcript, or natural-language text to any third-party provider.

#### Categories, Money Spaces, Search, and Filters

- **FR-051**: New accounts MUST receive starter expense categories (Food & Drink, Transport, Housing, Utilities, Shopping, Health, Education, Entertainment, Travel, Software & Services, Fees, Other Expense), starter income categories (Salary, Freelance, Business, Gift, Refund, Other Income), and starter Money Spaces (Personal, Work, Household, Freelance, Travel).
- **FR-052**: Users MUST be able to create, rename, deactivate, and restore their own categories and Money Spaces. Label mutations MUST require the current revision and reject stale writes without silent merge or overwrite.
- **FR-053**: Category and Money Space names MUST be unique per user after whitespace and case normalization within their respective active label type.
- **FR-054**: A label referenced by a Money Memo MUST NOT be physically removed until references are reassigned or the label is represented as inactive; history MUST remain understandable.
- **FR-055**: Money Spaces MUST be described and presented only as organizational context, with no balance, institution, account number, bank-sync, or payment behavior.
- **FR-056**: History search MUST support user-owned note/context, category name, and Money Space name without exposing search terms to diagnostics.
- **FR-057**: History filters MUST support date/range, income/expense, category, Money Space, purpose, planned/unplanned, currency, and active/archived state.
- **FR-058**: Combined filters MUST use intersection semantics, remain visible while active, and support individual removal and full reset.
- **FR-059**: Search and filter results MUST preserve stable history ordering and MUST provide loading, error, empty, and no-match states.
- **FR-060**: Search, label, and filter operations MUST remain account-scoped and MUST reveal no existence or values from another account.

#### Current-Month Overview and Monthly Review

- **FR-061**: Current-month overview MUST calculate deterministic income, expenses, and net movement from confirmed, non-deleted Money Memos whose occurrence falls within the reporting-timezone month.
- **FR-062**: Overview aggregates MUST include archived Money Memos and exclude drafts and Recently Deleted records.
- **FR-063**: Overview MUST display recent active Money Memos and separate per-currency category, planned/unplanned/unspecified, and personal/work/mixed/unspecified breakdowns when data exists.
- **FR-064**: Every breakdown MUST account for every eligible amount exactly once within its dimension, including explicit uncategorized or unspecified buckets.
- **FR-065**: Net movement MUST equal income minus expenses within one currency and MUST never be calculated across currencies.
- **FR-066**: Monthly review MUST allow selection of a calendar month and present per-currency income, expenses, net movement, largest expense categories, unplanned expenses, and comparison with the immediately preceding calendar month.
- **FR-067**: Category rankings MUST use summed eligible expense amount within one currency, descending amount, then normalized category name and immutable label identifier for deterministic ties.
- **FR-068**: Prior-month percentage change MUST be shown only when the prior value is nonzero; otherwise Cashmemo MUST show the absolute change and an explicit no-percentage explanation.
- **FR-069**: A currency section MUST appear only when the selected month or comparison month has eligible activity in that currency, unless the user explicitly filters to it.
- **FR-070**: No AI-generated narrative, advice, prediction, or autonomous insight is included in Feature 001 monthly review.
- **FR-071**: Calculation failure MUST NOT expose partial or stale values as current; unavailable sections MUST be named while capture/history remain usable.
- **FR-072**: Overview and review values MUST be reproducible from exported eligible Money Memos using documented calculation rules.

#### Privacy, Security, and Provider Boundaries

- **FR-073**: Cashmemo MUST NOT offer bank connections, bank synchronization, bank balances, payment initiation, intentionally request or encourage prohibited sensitive banking or identity information, infer it into dedicated attributes, or provide dedicated fields for bank credentials, bank account numbers, payment card numbers, CVV/CVC, banking access tokens, full bank statements, or government identifiers.
- **FR-074**: User interfaces MUST warn users not to enter prohibited data adjacent to every arbitrary free-text or voice entry point.
- **FR-075**: Supported finite prohibited-data detectors MUST run before user-authored or speech-derived content crosses each covered persistence or provider trust boundary. A detector match MUST trigger a warning and block that content from crossing the boundary until the candidate is removed or the capture is abandoned; Cashmemo MUST NOT store or transmit the matched candidate first and scrub it later. Detector rules and covered boundaries MUST be documented and testable.
- **FR-076**: Prohibited-data detection in arbitrary text MUST be documented as a best-effort control with measured false-positive/false-negative limitations and MUST never be described as complete semantic detection.
- **FR-077**: Feature 001 MUST satisfy Constitution 2.0.0 Principle I without a feature exception, and its privacy evidence MUST distinguish the hard dedicated-collection prohibition, mandatory controls for supported finite detector matches, best-effort semantic detection limits, diagnostic and unrelated-provider isolation, and user guidance.
- **FR-078**: Amounts, notes, transcripts, audio, counterparties, category details, Money Space names, search terms, export content, AI prompts/responses, candidate sensitive content, matched values, normalized detector material, and detector derivatives MUST NOT appear in logs, traces, metrics, analytics, crash reports, support diagnostics, acceptance evidence, URLs, client-visible internal errors, or AI/STT requests unrelated to the user's explicit current capture operation.
- **FR-079**: Diagnostics MUST use allowlisted operation names, coarse result classes, timings, service health, and opaque identifiers only.
- **FR-080**: All external input, including provider output and imported retry metadata, MUST be validated against explicit schemas before domain use.
- **FR-081**: Authorization MUST check resource ownership against authenticated identity for every protected operation and fail closed on uncertainty.
- **FR-082**: Cross-user isolation MUST be verified for reads, mutations, search, summaries, exports, drafts, labels, audio lifecycle, and deletion.
- **FR-083**: Secrets MUST come from runtime configuration and automated scanning MUST block committed credentials or secret-like values.
- **FR-084**: Provider selection MUST produce a versioned decision documenting training, retention, deletion, data residency where relevant, failure behavior, and replacement path before production use; any decision change MUST undergo a new review rather than silently replacing the approved record.
- **FR-085**: STT and AI providers MUST have model training and provider-side retention disabled through enforceable production controls. A provider unable to enforce both controls MUST NOT be used in production; approved processing and deletion behavior MUST still be disclosed.
- **FR-086**: Provider payloads MUST contain only data necessary for the requested transcription or extraction and MUST NOT include unrelated account or journal history.
- **FR-087**: Rate limits and abuse controls MUST protect authentication, capture, extraction, search, export, and deletion without exposing one user's activity to another.
- **FR-088**: Export, permanent purge, account deletion, session revocation, and sensitive preference changes MUST require recent authentication.
- **FR-089**: Security and privacy failures MUST produce safe, actionable user messages and content-free operational evidence.
- **FR-090**: Privacy incident handling for discovered prohibited persisted content MUST define containment, user correction/deletion, provider notification where applicable, evidence protection, and governance review before production launch.

#### Export, Record Deletion, Account Deletion, and Retention

- **FR-091**: Users MUST be able to request a versioned machine-readable export containing account preferences, active and archived Money Memos, recoverable drafts clearly labeled as drafts, categories, Money Spaces, and lifecycle metadata.
- **FR-092**: Export MUST provide documented JSON and tabular files with stable field meanings, canonical currency codes, occurrence timestamps/timezones, record states, and no converted or combined monetary values.
- **FR-093**: Export generation MUST be idempotent per request identity and MUST disclose generation, readiness, expiry, failure, and deletion states.
- **FR-094**: Export download MUST require recent authentication, use a single-account short-lived delivery mechanism, expire within 24 hours, and be deleted within 24 hours after expiry or explicit cancellation.
- **FR-095**: Recently Deleted MUST expose record deletion time, scheduled purge time, restore, and immediate purge actions without including records in normal financial views.
- **FR-096**: Record purge MUST remove confirmed content, associated drafts, transcript remnants, and derived metadata from live stores while preserving only content-free deletion evidence.
- **FR-097**: Account deletion MUST require recent authentication plus explicit destructive confirmation and MUST enter a seven-day grace period during which normal journal access is suspended and cancellation is permitted.
- **FR-098**: After the grace period, all live account data, sessions, exports, drafts, Money Memos, labels, transcripts, derived metadata, and provider-held deletable data MUST enter purge; live-store purge MUST complete within 24 hours under normal operation.
- **FR-099**: Deletion retries MUST be idempotent and MUST never recreate data or return a deleted account to active state after irreversible purge begins.
- **FR-100**: Encrypted automated operational backups MAY retain deleted data for at most 35 days. Every irreversible Money Memo or account purge MUST first create a content-free scope-specific suppression token derived from entity type and immutable entity identifier so restored copies can exclude and re-purge the exact memo or account before service release. Suppression removal MUST NOT occur before 42 days and MUST occur only after verification proves that every automated backup recovery window, manual/final or copied snapshot, replicated backup, and active isolated restore copy capable of resurrection is gone; unavailable or failed verification MUST retain the token, alert operators, and retry. Feature 001 infrastructure MUST prohibit untracked manual/final/replicated snapshots rather than treating elapsed time or an object-lifecycle rule as proof of safe suppression removal.
- **FR-101**: Cashmemo MUST disclose that backup expiry, legal security records, and provider confirmations may lag live purge, with each exception limited to content-free or inaccessible retained data and a defined maximum period.
- **FR-102**: Account deletion MUST NOT be reported complete while a required live-store purge is failed; provider deletion may be reported separately as pending with operational escalation.
- **FR-103**: Deletion and retention MUST have automated lifecycle tests per data class: confirmed records, drafts, raw audio, transcripts, AI metadata, exports, account identity, provider copies, and backups.
- **FR-104**: No deleted financial content MAY appear in acceptance evidence, deletion logs, support tickets, or operational deletion reports.

#### Production Usability, Reliability, and Evidence

- **FR-105**: Feature 001 MUST operate through real production-equivalent authentication, persistence, STT, AI extraction, export, deletion, monitoring, and backup/restore services; mocks alone cannot close integration requirements.
- **FR-106**: Cashmemo MUST be deployable as a responsive, installable PWA supporting current and previous major versions of mainstream mobile and desktop browsers selected during planning.
- **FR-107**: Core capture, review, authentication, export, and deletion interfaces MUST meet WCAG 2.2 AA requirements applicable to their controls, status messages, focus order, keyboard use, labels, and contrast.
- **FR-108**: Manual capture MUST reach an interactive state within 2 seconds for at least 95% of production-equivalent sessions under the declared normal-load profile.
- **FR-109**: Confirmed history and deterministic overview MUST display within 2 seconds for at least 95% of production-equivalent requests for accounts containing up to 10,000 Money Memos.
- **FR-110**: Core manual journal availability MUST target 99.5% per calendar month excluding announced maintenance; STT and AI availability MUST be measured separately.
- **FR-111**: A lost or delayed response MUST not cause duplicate writes, silent success, silent failure, or loss of recoverable draft work.
- **FR-112**: Monitoring MUST detect core availability, error rates, latency, provider health, queue/backlog state where applicable, deletion backlog, audio expiry backlog, export failures, and backup/restore failures without financial content.
- **FR-113**: Alerts and runbooks MUST distinguish core journal outage from STT/AI degradation and identify user-visible impact without exposing sensitive content.
- **FR-114**: Backup policy MUST target a maximum 24-hour recovery point for confirmed journal data and an 8-hour recovery time under the declared disaster scenario.
- **FR-115**: Restore procedure MUST be exercised at least quarterly in a production-equivalent environment and MUST verify ownership isolation, deletion tombstones, currency integrity, and deterministic totals before release.
- **FR-116**: Deployment MUST include rollback or safe-forward recovery, migration verification, secret scanning, privacy-safe diagnostic verification, and no silent partial release.
- **FR-117**: Required release gates MUST run in constitutional order: formatting/lint, type checking, unit tests, integration tests, privacy/security tests, then acceptance evidence per story.
- **FR-118**: Each user story MUST have production-equivalent acceptance evidence recording environment, command or procedure, result, and content-safe artifact references.
- **FR-119**: Feature 001 MUST NOT be considered complete because tasks are checked; every checked task requires corresponding deliverable and verification evidence, and every requirement requires an owner.
- **FR-120**: Production launch MUST be blocked by any failed mandatory hook, unresolved CRITICAL/HIGH analysis finding, dependency cycle, privacy gate failure, real-service acceptance gap, restore failure, or unapproved constitution conflict.

### Key Entities

- **Account**: One authenticated user identity with lifecycle state, session controls, preferences, and ownership of all journal data.
- **User Preferences**: Revisioned default currency, reporting timezone, locale, onboarding completion, and privacy acknowledgments used to interpret and present journal activity.
- **Money Memo**: One confirmed income or expense event with positive amount magnitude, currency, occurrence instant/timezone, optional organization/context, lifecycle state, retry identity, and revision.
- **Draft**: An unconfirmed, revisioned, separately stored manual, typed, transcript-derived, or AI-structured candidate with origin, recovery state, expiry, and no effect on authoritative financial views.
- **Temporary Audio**: Transient voice-processing input with owner, creation/expiry state, and deletion status; never permanent user content.
- **Transcript**: Editable STT output attached only to a draft and governed by draft/derived-data retention.
- **Category**: A revisioned user-owned income or expense classification label with starter/custom origin and active/inactive lifecycle.
- **Money Space**: A revisioned user-owned organizational context label without account, balance, institution, or payment semantics.
- **Export Job**: An idempotent account-scoped request with generation, ready, failed, expired, canceled, and deleted lifecycle states.
- **Deletion Job**: An idempotent record/account purge process with grace, pending, executing, provider-pending, completed, and failed operational states plus content-free evidence.
- **Provider Decision**: Approval record for an external STT, AI, or related provider covering purpose, data sent, training, retention, deletion, failure, residency, and replacement.

## Constitution Alignment

| Principle | Feature 001 disposition |
|-----------|-------------------------|
| I. Privacy by Default | Constitution 2.0.0 governs without a feature exception: intentional or dedicated collection is prohibited; supported finite detector matches block covered boundaries with user warning; semantic detection is explicitly best effort; candidate and detector material is isolated from diagnostics and unrelated provider requests; guidance is present at arbitrary-input entry points. |
| II. User-Confirmed Truth | Assisted output remains a separately modeled editable draft; explicit confirmation and user edits are authoritative. |
| III. Temporary Audio | Four deletion triggers, one-hour maximum retention, owner-enforced expiry, automated evidence, and the clarified 60-second recording limit are required. |
| IV. Graceful Degradation | Manual journaling remains available through accelerator outages; network loss preserves drafts without promising general offline synchronization. |
| V. Data Ownership | Versioned export and explicit per-class record/account deletion, provider, export, and backup lifecycles are required. |
| VI. Architecture Discipline | Product requirements require one deployable product boundary and provider replaceability; no microservices or speculative infrastructure is introduced by this specification. |
| VII. Reliability | Idempotency, recoverable drafts, revision conflicts, visible partial failure, deterministic ordering, and no silent loss are explicit. |
| VIII. Security | Schema validation, authenticated ownership, secret scanning, recent authentication, safe errors, and fail-closed behavior are explicit. |
| IX. Quality Gates | Independent stories, real-service evidence, ordered gates, privacy tests, hooks, analysis, and evidence-backed task completion are release requirements. |
| X. Scope Discipline | Prohibited finance/accounting scope, general offline synchronization, native apps, microservices, and speculative features are explicitly excluded. |

No historical or feature-specific exception is inherited, recreated, required, or approved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of representative first-time users can complete account access, privacy onboarding, and first manual Money Memo confirmation in under 5 minutes without assistance.
- **SC-002**: At least 95% of representative users can create a structured manual Money Memo in under 30 seconds after onboarding.
- **SC-003**: In production-equivalent retry tests, 100% of repeated identical create/confirmation requests produce exactly one confirmed Money Memo and conflicting payload reuse produces no write.
- **SC-004**: In concurrency tests, 100% of stale Money Memo edits are rejected without overwriting the latest confirmed revision.
- **SC-005**: Across supported monetary fixtures, 100% of stored and displayed amounts preserve declared currency precision and every aggregate exactly matches deterministic reference results.
- **SC-006**: Across all multi-currency fixtures, zero combined cross-currency totals, comparisons, rankings, or charts are produced.
- **SC-007**: At least 90% of representative natural-language samples produce a reviewable draft or an explicit correction state within 10 seconds under normal provider conditions; no sample auto-confirms.
- **SC-008**: At least 90% of supported-duration voice samples produce a reviewable transcript/draft or explicit failure state within 20 seconds after recording ends under normal provider conditions; provider accuracy is reported separately.
- **SC-009**: Automated lifecycle evidence proves deletion of raw audio after 100% of tested success, cancellation, unrecoverable-failure, and expiry paths.
- **SC-010**: STT and AI outage exercises leave 100% of manual create, view, edit, archive, restore, and delete acceptance scenarios operational when core services are available.
- **SC-011**: Network interruption exercises preserve 100% of declared recoverable drafts and create zero duplicate confirmed records after retry.
- **SC-012**: Current-month and monthly-review golden datasets produce exact expected per-currency totals, buckets, rankings, comparisons, timezone boundaries, and zero undefined percentage results.
- **SC-013**: At least 95% of normal-load manual capture, history, search, overview, and review interactions complete within 2 seconds for accounts containing up to 10,000 Money Memos.
- **SC-014**: Core manual journal availability meets or exceeds 99.5% per calendar month excluding announced maintenance; STT and AI SLOs are reported separately and never mask core status.
- **SC-015**: Cross-user security tests yield zero unauthorized reads, writes, search hits, summaries, drafts, exports, audio objects, or deletion operations.
- **SC-016**: Privacy scans of logs, traces, metrics, analytics, crash output, errors, URLs, and evidence find zero seeded sensitive financial values across every declared diagnostic channel.
- **SC-017**: Prohibited dedicated fields and solicitation appear zero times in released interfaces; best-effort arbitrary-text controls publish measured limitations and never claim semantic completeness.
- **SC-018**: 100% of provider decisions used in production document disabled training, retention/deletion behavior, data sent, failure behavior, and replacement path; any missing approval blocks launch.
- **SC-019**: Export completeness tests account for 100% of eligible account records and preferences, preserve currencies/timezones/states, and produce no converted monetary value.
- **SC-020**: Expired/canceled exports become inaccessible within 24 hours, expired record deletions purge live data within 24 hours under normal operation, and account live-store purge completes within 24 hours after grace expiry under normal operation.
- **SC-021**: Restore drills demonstrate recovery point no worse than 24 hours and recovery time no worse than 8 hours for the declared disaster scenario, with zero resurrected individually purged Money Memos or deleted accounts; suppression-cleanup tests retain tokens whenever any resurrection-capable backup, snapshot, replica, or restore copy exists or cannot be verified.
- **SC-022**: All applicable WCAG 2.2 AA automated checks pass and manual keyboard, focus, status-message, label, and contrast review has no unresolved critical issue.
- **SC-023**: Every P1 and P2 story has passing production-equivalent acceptance evidence, including its degraded/failure and privacy scenarios.
- **SC-024**: Before launch, 100% of functional requirements and buildable success criteria map to implementation plus automated-test or explicit manual-evidence ownership.
- **SC-025**: Launch proceeds only with zero unresolved mandatory-hook failures, CRITICAL/HIGH analysis findings, dependency cycles, constitution conflicts, privacy failures, restore failures, or real-service acceptance gaps.
- **SC-026**: In traversal-concurrency tests, 100% of continuations whose result-set version or canonical query/filter binding became obsolete return `RESULTS_CHANGED`, while unchanged traversals preserve stable keyset order without duplicates or omissions and return zero purged or inaccessible records.

## MVP Completion Definition

Feature 001 is complete only when all P1 and P2 stories work in a production deployment; real
authentication, persistence, STT, AI extraction, monitoring, export, deletion, backup, and restore
paths have production-equivalent evidence; manual journaling remains safe during accelerator outages;
all calculations remain deterministic and currency-separated; all lifecycle and cross-user privacy
tests pass; every requirement has delivery and verification ownership; every checked task has an
actual deliverable and evidence; and every mandatory quality gate passes with no unapproved
constitution conflict.

## Explicitly Out of Scope

- Bank synchronization, bank balances, bank-account tracking, direct banking connections, or bank data import.
- Payment processing, money transfer, cards, wallets, or payment initiation.
- Investment tracking, trading, portfolio valuation, or autonomous financial advice.
- Tax filing, payroll, invoicing, double-entry bookkeeping, or full accounting.
- Currency conversion, exchange rates, consolidated multi-currency valuation, or base-currency reporting.
- Advanced budgeting, savings goals, recurring transactions, reminders, or irregular-income planning.
- Receipt scanning or OCR.
- Ask Cashmemo chatbot, advanced behavioral AI insights, forecasts, or AI-authored monthly advice.
- Native iOS or Android applications.
- Family, team, shared-account, delegated-access, or collaborative-finance features.
- General-purpose offline synchronization or an offline authoritative ledger.
- Microservices, speculative infrastructure, or provider-specific architecture not justified during planning.

## Assumptions

- Feature 001 serves individual users managing their own private journal; no shared ownership exists.
- User interface language is English for MVP, while dates, times, and currency display respect saved locale and reporting-timezone preferences.
- Supported currency availability comes from a maintained versioned registry; supporting a currency does not imply conversion support.
- Category, Money Space, purpose, and planning status are optional; absent values appear in explicit uncategorized/unspecified buckets rather than being inferred.
- Archive is organizational, not financial deletion, so archived records remain in deterministic totals until deleted.
- A network connection is required for authoritative confirmation and protected account operations; same-device draft recovery is not general offline synchronization.
- Provider accuracy targets are measured on a representative approved corpus and are not guarantees for every accent, language, phrasing, or financial context.
- Operational SLOs are evaluated against a declared normal-load profile and separately report excluded scheduled maintenance and provider incidents.
- Backup retention contains inaccessible disaster-recovery copies only; backup content is never used for product queries or post-deletion account restoration.
