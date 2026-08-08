# Feature Specification: Cashmemo MVP

**Feature Branch**: `main`  
**Feature Directory**: `specs/001-cashmemo-mvp`  
**Created**: 2026-08-09  
**Status**: Draft — specification and clarification only  
**Input**: Redefine Cashmemo as a privacy-first money journal and ship its first production-usable
MVP without inheriting requirements, assumptions, acceptance state, planning, or tasks from the
superseded `001-money-memo-foundation` feature.

## Product Intent

Cashmemo helps a person record income and expense events, preserve why money moved, and understand
their money over time. It records **Money Events**, not bank accounts. Its core thesis is:

> Traditional finance apps primarily remember transactions. Cashmemo should remember money
> activity, context, and decisions.

Cashmemo works without bank connections. AI and voice accelerate capture but never become
authoritative financial truth. A complete MVP is a deployed product usable by real users with real
identity, persistence, speech-to-text, structured extraction, privacy controls, operational
evidence, data export, and deletion—not a mock-only demonstration.

## Constitution Alignment and C-07 Disposition

Cashmemo Constitution v1.0.0 remains applicable. Its ten principles align with this MVP except for
one literal conflict in Principle I.

The same unavoidable conflict behind historical exception C-07 still exists and now covers more
surfaces: notes, category and Money Space names, natural-language capture, transcripts, and search
all accept arbitrary human language. Voice audio must reach speech-to-text before its semantic
content is known. No finite detector can prove that arbitrary text or speech contains none of the
prohibited data classes across every language, format, obfuscation, or ambiguity.

C-07 is therefore **necessary in substance but not silently inherited**. For this new Feature 001:

- hard product guarantees are limited to never requesting, encouraging, inferring, or providing
  dedicated fields for prohibited banking data; never connecting to a bank; blocking documented
  high-confidence patterns where detection can run before storage or onward processing; and never
  placing user financial content in operational telemetry;
- adjacent warnings, finite detection, provider controls, and incident response are best-effort
  controls, not proof of complete semantic detection;
- a false negative in arbitrary user-authored text, search, transcript, or spoken audio is a known
  limitation and privacy-incident risk, never intended collection;
- the historical C-07 task references and acceptance evidence do not carry forward;
- before implementation planning is approved, governance MUST either amend Principle I to state
  enforceable arbitrary-input boundaries or record a newly scoped C-07 exception for this feature
  with owner, controls, review interval, accepted risk, and removal plan.

This specification adopts the honest boundary above. It does not claim an impossible universal
privacy or availability guarantee.

## Clarifications

### Session 2026-08-09

- Q: May each memo use a different currency, and how must overview/review aggregate them? → A: Each
  memo may use any supported currency. All totals, breakdowns, and comparisons remain separated by
  currency; Cashmemo performs no conversion or consolidated cross-currency valuation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Start Using Cashmemo Safely (Priority: P1)

A new user can open the production PWA, create and verify an account, understand what Cashmemo does
and does not collect, choose basic preferences, and reach a useful empty state. A returning user can
restore a valid session or authenticate again without losing a recoverable capture draft.

**Why this priority**: No other journey has value without trusted identity, clear privacy
expectations, and a configured money context.

**Independent Test**: Starting with no account, a person can register, review privacy disclosures,
set currency and timezone, sign out, sign back in, and see an empty history ready for capture.

**Acceptance Scenarios**:

1. **Given** a new visitor, **When** they register with a valid email and password and complete
   verification, **Then** Cashmemo creates one isolated account and begins onboarding.
2. **Given** onboarding, **When** the user reviews the privacy explanation and chooses default
   currency, timezone, and display locale, **Then** those choices are saved and an empty home state
   explains how to record the first Money Memo.
3. **Given** a returning user with a valid session, **When** they reopen the installed or browser
   PWA, **Then** their session and preferences are restored without another login prompt.
4. **Given** an expired or revoked session while a capture draft exists, **When** a protected save
   is attempted, **Then** Cashmemo preserves the draft, asks the user to authenticate, and resumes
   the draft after successful authentication.
5. **Given** a signed-in user, **When** they log out, **Then** the current device session is revoked,
   protected data disappears from view, and any unsynchronized local draft receives an explicit
   keep-or-discard warning before local removal.

**Degraded/failure behavior**: Registration, verification, reset, or session failures name the
failed capability without exposing account existence or sensitive content. A failed preference save
retains selections for retry and does not falsely report completion.

---

### User Story 2 — Record and Manage Money Memos Manually (Priority: P1)

A user can manually create an income or expense Money Memo, review every field, explicitly save it,
find it in history, correct it, archive and restore it, move it through Recently Deleted, restore it
within the recovery window, or permanently delete it.

**Why this priority**: Manual capture is the reliable core product and must remain useful without
speech-to-text or AI.

**Independent Test**: With AI and speech-to-text unavailable, a user can complete the full Money
Memo lifecycle and see deterministic history and totals update correctly.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they enter a valid type, amount, currency, occurrence time,
   purpose, planned status, and optional organization/context and explicitly save, **Then** exactly
   one authoritative Money Memo appears in history.
2. **Given** an incomplete or invalid memo, **When** the user tries to save, **Then** Cashmemo marks
   every invalid field, preserves all input, and creates no confirmed memo.
3. **Given** a confirmed memo, **When** its owner edits and saves against the current revision,
   **Then** the corrected memo replaces that revision and all deterministic views recalculate.
4. **Given** a stale edit, **When** the user attempts to save after another session changed the
   memo, **Then** Cashmemo rejects the stale write, shows both current and unsaved values, and lets
   the user choose how to proceed without silent overwrite.
5. **Given** an active memo, **When** its owner archives and later restores it, **Then** its
   financial meaning and monthly calculations do not change; only default history visibility does.
6. **Given** a memo in Recently Deleted, **When** its owner restores it before expiry, **Then** the
   memo returns to its prior active or archived state.
7. **Given** a memo in Recently Deleted, **When** its owner confirms permanent deletion or the
   recovery window expires, **Then** it becomes immediately inaccessible and enters the documented
   physical-deletion lifecycle.
8. **Given** a network timeout after save, **When** the client safely retries the same submission,
   **Then** Cashmemo returns the original result and does not create a duplicate memo.

**Degraded/failure behavior**: Any recoverable create or edit failure leaves an intact draft or
unsaved edit. No error, retry, archive, restore, or delete operation silently changes another memo.

---

### User Story 3 — Capture a Draft Using Natural Language or Voice (Priority: P1)

A user can describe a money event in text or speech. Cashmemo converts speech to an editable
transcript, extracts an editable structured draft, clearly marks missing or ambiguous values, and
requires explicit confirmation before creating an authoritative Money Memo.

**Why this priority**: Low-friction contextual capture is Cashmemo's key differentiator, while
mandatory review protects trust.

**Independent Test**: Using real configured speech-to-text and AI services, a user can speak or type
an event, correct every extracted field, confirm once, and see exactly one memo; service failures
still leave a usable manual path.

**Acceptance Scenarios**:

1. **Given** natural-language input such as “Spent 85 thousand for lunch with a client today, work
   expense,” **When** extraction succeeds, **Then** Cashmemo presents—not saves—an editable expense
   draft with amount, currency, occurrence time, category, Money Space, purpose, planned status, and
   note populated only where supported by the input or user defaults.
2. **Given** an extraction with missing or ambiguous amount, currency, date, or type, **When** the
   draft appears, **Then** the uncertain field is blank or explicitly marked for review and
   confirmation remains blocked until required fields are valid.
3. **Given** a user starts voice capture after seeing the audio/provider notice, **When** they stop
   recording and transcription succeeds, **Then** they can review and edit the transcript before
   or while generating the structured draft.
4. **Given** a valid AI-generated draft, **When** the user edits fields but has not confirmed,
   **Then** no authoritative Money Memo exists and overview/history totals remain unchanged.
5. **Given** a reviewed draft, **When** the user explicitly confirms it, **Then** exactly one Money
   Memo is created from the visible field values and later provider output cannot alter it.
6. **Given** speech-to-text fails while temporary audio remains inside its retention window,
   **When** the user chooses retry, **Then** Cashmemo retries without requiring a new recording;
   manual entry and cancellation remain available.
7. **Given** AI extraction fails or times out, **When** the failure appears, **Then** the transcript
   or typed text and all user edits remain available and the user can complete the draft manually.
8. **Given** successful transcription, cancellation, unrecoverable failure, or audio expiry,
   **When** that lifecycle event occurs, **Then** raw audio is deleted and cannot be replayed or
   restored by the user or normal operations.

**Degraded/failure behavior**: Speech-to-text and AI failures are isolated. They never corrupt a
confirmed memo, erase surviving text/draft input, or disable manual capture.

---

### User Story 4 — Understand Current-Month Money Activity (Priority: P1)

A user can open Home and understand current-month income, expenses, net movement, recent memos,
largest expense categories, planned versus unplanned expenses, and useful purpose split without a
large financial dashboard.

**Why this priority**: Regular use needs a quick payoff after capture—a trustworthy view of what
happened this month.

**Independent Test**: With a known set of confirmed memos, Home reproduces exact hand-calculated
totals and updates after create, edit, delete, restore, or month-boundary changes.

**Acceptance Scenarios**:

1. **Given** confirmed current-month memos, **When** Home opens, **Then** it shows deterministic
   income, expenses, and net movement per currency plus recent memos.
2. **Given** current-month expenses, **When** Home opens, **Then** it shows useful expense-category,
   planned/unplanned, and personal/work/mixed breakdowns without inventing financial advice.
3. **Given** only drafts, archived memos, or Recently Deleted memos, **When** Home calculates totals,
   **Then** drafts and Recently Deleted memos are excluded while archived confirmed memos remain
   included.
4. **Given** no current-month confirmed memos, **When** Home opens, **Then** it shows zero totals and
   a clear first-capture action rather than an error or misleading chart.
5. **Given** one Home section fails to load, **When** other sections are available, **Then** the
   available deterministic data remains visible and the failed section offers a safe retry.

**Degraded/failure behavior**: AI and speech-to-text availability never affects calculations.
Cached figures are labeled with their last refresh time and never presented as current after a
failed refresh.

---

### User Story 5 — Organize and Find Money Memos (Priority: P2)

A user can create and manage categories and Money Spaces, assign them to memos, search context, and
combine filters to find useful history. Money Spaces remain organizational concepts, never bank
accounts.

**Why this priority**: Organization and retrieval turn isolated entries into a durable journal.

**Independent Test**: A user with a varied history can create organization labels, assign them,
combine every required filter, search context, clear filters, and recover predictable results.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they create, rename, archive, or restore a category or
   Money Space, **Then** the change affects only their account and preserves referenced memo meaning.
2. **Given** a Money Space form, **When** the user attempts to enter account numbers, balances,
   credentials, or bank-connection details, **Then** Cashmemo provides no dedicated fields and
   reiterates that a Money Space is not an account.
3. **Given** varied history, **When** the user combines date range, income/expense, category, Money
   Space, purpose, planned/unplanned, and lifecycle filters, **Then** results satisfy all selected
   filters and the active criteria stay visible.
4. **Given** a search phrase, **When** the user searches, **Then** Cashmemo finds matching memo notes,
   category names, and Money Space names within that user's accessible history only.
5. **Given** no matching history, **When** filters or search complete, **Then** an empty result state
   explains the active constraints and offers a one-action reset.

**Degraded/failure behavior**: A failed search or page load exposes no query or memo content in the
error or telemetry, retains current filters, and permits retry.

---

### User Story 6 — Review a Month (Priority: P2)

A user can select a month and see a compact deterministic review: income, expenses, net movement,
largest spending categories, unplanned expenses, useful purpose split, and comparison with the
prior completed month.

**Why this priority**: A monthly reflection supports decisions without expanding MVP into advanced
analytics or financial advice.

**Independent Test**: A tester can seed two known months and reproduce every displayed value using
the published calculation rules without AI.

**Acceptance Scenarios**:

1. **Given** a completed selected month, **When** review opens, **Then** it shows exact totals and the
   top five expense categories per currency.
2. **Given** a prior completed month, **When** comparable values exist, **Then** Cashmemo shows
   absolute and percentage change using the same currency and calculation rules.
3. **Given** no prior comparable value or a zero denominator, **When** comparison is calculated,
   **Then** Cashmemo says comparison is unavailable instead of showing infinity or a misleading
   percentage.
4. **Given** a current incomplete month, **When** review opens, **Then** it labels the period as
   month-to-date and omits full-month comparison.
5. **Given** no confirmed memos in the month, **When** review opens, **Then** it shows a useful empty
   review and does not generate a narrative.

**Degraded/failure behavior**: Review remains deterministic and usable with AI unavailable. AI
narrative is excluded from Feature 001.

---

### User Story 7 — Own, Export, and Delete My Data (Priority: P2)

A user can understand Cashmemo's data processing, export a portable snapshot, permanently delete
individual memos, and permanently delete their account and owned data through a clear lifecycle.

**Why this priority**: Privacy-first product claims require usable exit and deletion paths, not only
policy language.

**Independent Test**: An authenticated owner can export a complete documented snapshot, verify its
contents, request account deletion, lose access immediately, and observe deletion evidence across
live data, providers, and bounded backups.

**Acceptance Scenarios**:

1. **Given** active, archived, draft, and Recently Deleted user data, **When** the owner exports,
   **Then** Cashmemo produces a documented machine-readable snapshot containing every non-purged
   owned record and its lifecycle state, while excluding secrets and internal operational metadata.
2. **Given** data changes during export, **When** export completes, **Then** it represents one stated
   acceptance instant and contains no partial or duplicate record versions.
3. **Given** an authenticated owner, **When** they start account deletion, **Then** Cashmemo explains
   irreversible effects, requires recent authentication plus explicit typed confirmation, and
   offers data export before final confirmation.
4. **Given** confirmed account deletion, **When** the request is accepted, **Then** all sessions are
   revoked, account data becomes inaccessible immediately, transient provider work is canceled,
   and physical deletion follows the stated service and backup windows.
5. **Given** a deletion request during provider or scheduler failure, **When** service recovers,
   **Then** deletion resumes idempotently, overdue work alerts operators, and the user data never
   becomes accessible again.

**Degraded/failure behavior**: Failed export never produces a misleading partial file. Failed
deletion confirmation changes nothing. Accepted deletion survives retries and infrastructure
restore.

---

### User Story 8 — Keep Working Through Dependency and Network Failures (Priority: P2)

A user can continue manual capture when AI or speech-to-text is unavailable and can preserve a
bounded local capture draft during a temporary network outage for later explicit submission.

**Why this priority**: Money events are time-sensitive; optional accelerators and recoverable
connectivity failures must not cause lost context.

**Independent Test**: With speech-to-text, AI, and network access independently disabled, a user can
observe accurate degraded states, retain input, resume online, and create exactly one memo.

**Acceptance Scenarios**:

1. **Given** AI or speech-to-text is unavailable, **When** the user opens capture, **Then** manual
   entry remains available and the unavailable accelerator is named.
2. **Given** a network outage during manual entry, **When** the user continues editing, **Then** a
   feature-scoped local draft preserves their input and is visibly marked unsynchronized.
3. **Given** connectivity returns, **When** the user reviews and submits the recovered draft,
   **Then** it is revalidated, requires explicit confirmation, and creates at most one memo.
4. **Given** an unrecoverable local-storage failure, **When** Cashmemo detects it, **Then** it warns
   before further input, offers copy/download where possible, and never claims the draft is saved.
5. **Given** stale cached history during an outage, **When** it is shown, **Then** Cashmemo labels it
   as unavailable or stale and does not allow unverified edits to masquerade as saved changes.

**Degraded/failure behavior**: Offline capability is limited to capture-draft preservation and
retry. General-purpose offline history synchronization, conflict merging, and background financial
operations remain out of scope.

### Edge Cases and Failure Handling

- Amount is zero, negative, exceeds 15 integer digits, uses too many fractional digits for its
  currency, or contains locale separators that are ambiguous.
- A relative date crosses midnight, month, year, daylight-saving, or timezone boundaries between
  capture and review.
- Device clock differs from service time; occurrence more than five minutes in the future requires
  correction or explicit selection after the time passes.
- AI returns malformed, extra, contradictory, unsupported, or prompt-injected content; only the
  allowed draft fields are considered and no action is executed.
- AI produces one valid field and several invalid fields; valid user input remains while invalid or
  ambiguous output stays unconfirmed.
- Recording permission is denied, microphone disappears, audio upload is interrupted, recording
  exceeds limit, or the tab closes mid-recording.
- Raw audio expires before retry; text/manual capture remains and the UI states that re-recording is
  required.
- Confirmation times out after the server accepted it; retry returns the same memo.
- Two devices edit, archive, restore, or delete the same memo or organization label concurrently;
  stale mutations are rejected and no silent last-write-wins occurs.
- A category or Money Space is archived while a memo draft references it; user must select an active
  value or explicitly retain the existing reference where permitted.
- A memo's category or Money Space later becomes archived; historical display and calculations keep
  the original reference.
- Month totals contain multiple currencies; every amount stays separated by currency and no
  conversion or consolidated valuation appears.
- Search or filter selection changes while a prior request is still pending; stale results do not
  replace the latest requested view.
- A memo is restored at the same time its Recently Deleted window expires; one authoritative server
  decision wins and the client reports the final state.
- Account deletion starts while an export, transcription, extraction, or memo mutation is pending;
  deletion revokes new writes, cancels transient work, and wins over later completion.
- A restore uses backup data that predates a deletion; suppression/reconciliation prevents deleted
  accounts and memos from becoming accessible again.
- A provider has no acceptable no-training or retention controls, changes its terms, or routes data
  through an undocumented region/subprocessor; assisted capture is disabled until review passes.
- Telemetry processing fails; product operations continue where safe, but sensitive content is never
  added as diagnostic fallback.

## Requirements *(mandatory)*

### Functional Requirements

#### Account, Authentication, and Onboarding

- **FR-001**: Cashmemo MUST let a person register with an email address and password, verify control
  of that address, sign in, sign out, and reset a forgotten password without disclosing whether an
  unrelated address has an account.
- **FR-002**: A user account MUST own exactly one private data scope. Every protected read, write,
  export, and deletion operation MUST derive ownership from the authenticated principal rather than
  a client-supplied owner identifier.
- **FR-003**: Cashmemo MUST restore an unexpired session after browser or installed-PWA restart and
  MUST require authentication again after revocation, expiry, credential reset, or account deletion.
- **FR-004**: Sessions MUST expire after 30 days without authentication activity. Logout MUST revoke
  the current session; credential reset and account deletion MUST revoke all sessions.
- **FR-005**: Cashmemo MUST require recent authentication within the preceding 15 minutes before
  data export, immediate permanent memo deletion, or account deletion.
- **FR-006**: Onboarding MUST explain that Cashmemo records user-entered money events, does not connect
  to banks, provides no bank/account fields, uses user-confirmed drafts for AI-assisted capture, and
  processes temporary audio only with explicit user action.
- **FR-007**: Before first assisted capture, Cashmemo MUST disclose configured speech-to-text and AI
  providers, data sent, processing purpose, regions where known, provider retention/training
  controls, and manual alternative; declining assisted capture MUST leave manual entry usable.
- **FR-008**: Onboarding MUST require a default currency and timezone and MUST offer a display locale.
  Preferences MUST remain editable later.
- **FR-009**: Changing default currency MUST affect new drafts only. Changing timezone MUST change
  future period grouping and display after warning the user; it MUST NOT mutate stored occurrence
  instants or prior memo field values.
- **FR-010**: New accounts MUST receive a usable empty Home/history state, a default Personal Money
  Space, and a small editable starter category set clearly presented as organizational defaults.
- **FR-011**: Authentication, onboarding, and preference screens MUST define loading, success, empty,
  validation, retryable failure, non-retryable failure, and session-expired states.

#### Money Memo Meaning and Validation

- **FR-012**: A confirmed Money Memo MUST belong to exactly one user and contain: income or expense
  type; positive amount; currency; occurrence instant and captured timezone; category or explicit
  Uncategorized state; Money Space; personal, work, or mixed purpose; planned or unplanned status;
  lifecycle state; and revision.
- **FR-013**: A Money Memo MAY contain a note/context value up to 2,000 Unicode characters. Cashmemo
  MUST reject overflow without truncation and preserve the unsaved value for correction.
- **FR-014**: Amount MUST be greater than zero, contain at most 15 integer digits, and contain no more
  fractional digits than the selected currency supports. Direction MUST come from type; negative
  amounts are invalid.
- **FR-015**: Cashmemo MUST parse locale-aware amount entry visibly and MUST require correction when
  separators or abbreviations permit more than one reasonable amount. Display formatting MUST NOT
  change stored numeric value.
- **FR-016**: Currency MUST use a supported ISO 4217 code. Cashmemo MUST NOT convert currencies,
  fetch exchange rates, or combine currencies into one valuation.
- **FR-017**: Occurrence date and time are required. Cashmemo MUST store an unambiguous instant plus
  the user-selected IANA timezone used to interpret the entered wall time.
- **FR-018**: Occurrence more than five minutes after current service time MUST be rejected. Planned
  status describes whether an already occurring expense or income was anticipated; it does not
  schedule future transactions.
- **FR-019**: Editing occurrence wall time or timezone MUST show the resulting instant before save.
  Existing monthly views MUST recalculate only after successful confirmation of that edit.
- **FR-020**: Purpose MUST be personal, work, or mixed. Planned status MUST be planned or unplanned.
  New drafts MAY use explicit user defaults, but every value remains visible and editable.
- **FR-021**: Category and Money Space labels MUST never change amount, type, currency, occurrence,
  purpose, planned status, or note values.
- **FR-022**: Cashmemo MUST validate every externally supplied field against an explicit allowlist of
  fields, type, length, format, and relationship rules and MUST reject unknown fields.
- **FR-023**: Validation errors MUST identify safe field/rule information without echoing amount,
  note, transcript, category, Money Space, search, or other user-authored content.

#### Drafts, Confirmation, Retry, and Concurrency

- **FR-024**: Drafts MUST be structurally distinct from confirmed Money Memos and MUST never appear
  in history, overview, review, export financial totals, or search results as authoritative records.
- **FR-025**: Manual entry MUST remain a draft until the user explicitly selects Save. Assisted entry
  MUST remain a draft until the user explicitly selects Confirm Money Memo after reviewing the
  structured fields.
- **FR-026**: Every AI- or speech-derived field MUST be visible and editable before confirmation. No
  hidden extracted field may be persisted in the confirmed memo.
- **FR-027**: Cashmemo MUST preserve authenticated drafts after each material edit and across reload,
  session expiry, retryable provider failure, and retryable network failure.
- **FR-028**: During network loss, Cashmemo MAY use feature-scoped durable local storage only for
  capture drafts and their retry state. It MUST show synchronization state and MUST not imply that a
  local draft is confirmed or remotely backed up.
- **FR-029**: A draft MUST expire 30 days after its last user edit. Cashmemo MUST show expiry status
  and warn on access during the final seven days. Expiry deletes draft text, transcript, extraction
  metadata, and local retry state; raw audio follows its shorter independent window.
- **FR-030**: User cancellation MUST delete the selected draft and its derived transcript/extraction
  data after explicit warning when unsaved input would be lost.
- **FR-031**: Every retryable create, confirm, edit, archive, restore, Recently Deleted, permanent
  delete, and account-delete request MUST have stable request identity. Repeating the same accepted
  request for at least 24 hours MUST return the same outcome without duplicate mutation.
- **FR-032**: Mutable confirmed memos, categories, Money Spaces, and drafts MUST use revision checks.
  A stale write MUST be rejected rather than silently overwritten.
- **FR-033**: After a stale-write rejection, Cashmemo MUST show the latest saved state and preserve
  the user's unsaved state so the owner can reload, copy, or intentionally apply a new edit.
- **FR-034**: No failure path may silently discard, truncate, confirm, archive, restore, delete, or
  modify user input or confirmed data.

#### Manual Memo Lifecycle

- **FR-035**: An authenticated user MUST be able to create, view, list, and edit only their own Money
  Memos through manual entry without speech-to-text, AI, bank connection, or shared cache dependency.
- **FR-036**: History MUST order memos by occurrence time descending with a stable tie-breaker and
  MUST preserve that ordering across pagination.
- **FR-037**: Archive MUST hide a memo from default history while preserving it as an authoritative
  financial record included in overview, review, search when lifecycle filter includes it, and
  export.
- **FR-038**: Restore from archive MUST return the memo to active history without altering financial
  fields or revision history beyond the lifecycle change.
- **FR-039**: Deleting an active or archived memo MUST move it to Recently Deleted for 30 days and
  remember its prior active/archive state.
- **FR-040**: Recently Deleted memos MUST be excluded from default history, search, overview, monthly
  review, and financial totals, but listed in a dedicated recovery view with exact purge deadline.
- **FR-041**: Restoring before the purge deadline MUST return the memo to its prior active/archive
  state. After the deadline it MUST be inaccessible even if physical cleanup is delayed.
- **FR-042**: Immediate permanent deletion from Recently Deleted MUST require recent authentication
  and a second explicit confirmation naming the irreversible result.
- **FR-043**: Physical deletion of a permanently deleted or expired memo MUST complete within 24 hours
  under normal service availability. Overdue work MUST retry idempotently and alert operators.
- **FR-044**: Backup copies containing a deleted memo MUST become incapable of restoring it to user
  access no later than 30 days after logical deletion through bounded retention plus deletion
  reconciliation.
- **FR-045**: Any read or mutation by a non-owner MUST return no record content and MUST be
  indistinguishable from an unknown record to that requester.

#### Natural-Language and Voice-Assisted Capture

- **FR-046**: Cashmemo MUST accept user-initiated natural-language capture and generate an editable
  draft containing only supported Money Memo fields.
- **FR-047**: Original typed capture text MUST remain draft-only and MUST be deleted on confirmation,
  cancellation, or draft expiry unless the user explicitly copies it into the memo note.
- **FR-048**: Structured extraction MUST classify each field as directly supported, inferred from an
  explicit user default, ambiguous, or missing. It MUST NOT present uncalibrated numeric confidence
  as financial certainty.
- **FR-049**: When amount, currency, type, or occurrence has multiple reasonable interpretations,
  extraction MUST leave the value unresolved or present explicit alternatives. It MUST NOT silently
  choose an authoritative value.
- **FR-050**: Relative dates MUST be interpreted from capture time in the user's current timezone and
  displayed as an absolute date/time for review before confirmation.
- **FR-051**: AI output MUST be treated as untrusted input and constrained to supported draft fields.
  It MUST NOT execute instructions, call financial actions, retrieve another user's data, create a
  confirmed memo, or modify confirmed data.
- **FR-052**: Cashmemo MUST support user-controlled start, stop, retry, and cancel for voice capture
  and MUST show recording, uploading, transcribing, extracting, ready, failure, and expiry states.
- **FR-053**: Each voice recording MUST be limited to two minutes. Reaching the limit MUST stop
  recording visibly and preserve the captured portion for the normal temporary-audio flow.
- **FR-054**: Raw audio MUST be isolated as temporary processing input, never user journal content,
  and MUST never appear in history, export, analytics, logs, traces, crash reports, or backups.
- **FR-055**: Raw audio MUST be deleted after successful transcription, user cancellation,
  unrecoverable failure, account deletion, or one hour after recording start—whichever occurs first.
- **FR-056**: A recoverable speech-to-text failure MAY retain audio only within that one-hour window
  for explicit retry. Cashmemo MUST show the remaining retry window and a Delete now action.
- **FR-057**: Transcript MUST be editable, visibly non-authoritative, and draft-only. It MUST be
  deleted on confirmed memo creation, cancellation, draft expiry, or account deletion unless the
  user explicitly copies content into the memo note.
- **FR-058**: Speech-to-text failure MUST preserve surviving transcript fragments and user edits,
  name the unavailable capability, and offer retry, manual transcription, or manual entry.
- **FR-059**: AI extraction failure MUST preserve typed input, transcript, and user edits; name the
  unavailable capability; and offer retry or manual structured entry.
- **FR-060**: Confirming an assisted draft MUST persist exactly the visible validated Money Memo
  fields and discard provider output, original capture text, transcript, and extraction metadata
  not explicitly selected as memo content.
- **FR-061**: No provider callback, retry, delayed response, or later model run may confirm, modify,
  categorize, enrich, archive, restore, or delete a confirmed Money Memo.
- **FR-062**: Assisted capture MUST support at least English and Indonesian speech/text input at MVP
  launch. Unsupported or low-quality language detection MUST be visible and fall back to editable
  transcript/manual entry.

#### Categories, Money Spaces, Search, and History Filters

- **FR-063**: Each category and Money Space MUST belong to one user and have a unique active name
  within that type for that owner using documented case/whitespace normalization.
- **FR-064**: Users MUST be able to create, rename, archive, and restore their categories and Money
  Spaces. Archived values remain attached to historical memos but cannot be selected for new memos.
- **FR-065**: Cashmemo MUST prevent permanent deletion of a category or Money Space while a
  non-purged memo references it and MUST offer reassignment before deletion.
- **FR-066**: Money Spaces MUST contain only organizational identity such as name and optional
  description. They MUST NOT contain balances, account/card numbers, institution credentials,
  routing data, access tokens, statement uploads, or bank-connection controls.
- **FR-067**: Users MUST be able to assign one category and one Money Space to a memo, including an
  explicit Uncategorized category state. Feature 001 does not support multi-category or multi-space
  assignment on one memo.
- **FR-068**: History MUST support date/range, income/expense, category, Money Space, purpose,
  planned/unplanned, and active/archive/Recently Deleted filters.
- **FR-069**: Multiple active filters MUST combine with AND semantics; multi-selection within one
  filter type MUST use OR semantics. Active filters MUST remain visible and clearable individually
  or all at once.
- **FR-070**: Search MUST match user-accessible memo notes, category names, and Money Space names
  using case-insensitive contains behavior. Search MUST not include raw audio, expired draft input,
  deleted transcripts, or another user's content.
- **FR-071**: Search queries MUST be transient, excluded from analytics and operational telemetry,
  and deleted after request processing. Saved searches and search history are out of scope.
- **FR-072**: History and search MUST define initial loading, incremental loading, refreshing, empty,
  no-result, stale-data, partial-section failure, and complete failure states.
- **FR-073**: A late response for an older query/filter state MUST NOT replace newer requested
  results.

#### Home and Monthly Review Calculations

- **FR-074**: Home MUST use the user's current timezone to define the current calendar month and
  MUST label its exact date boundaries.
- **FR-075**: Home MUST show current-month income, expenses, net movement, recent Money Memos, top
  expense categories, planned versus unplanned expenses, and personal/work/mixed breakdown where
  non-empty.
- **FR-076**: Income MUST equal the exact sum of included income amounts; expenses MUST equal the
  exact sum of included expense amounts; net movement MUST equal income minus expenses.
- **FR-077**: Calculations MUST include active and archived confirmed memos whose occurrence instant
  falls within the period in the user's current timezone. They MUST exclude drafts and Recently
  Deleted or permanently deleted memos.
- **FR-078**: Every overview and review total MUST be grouped by currency. Default currency appears
  first; other present currencies appear separately. No cross-currency sum or comparison is allowed.
- **FR-079**: Category breakdown MUST use expense memos only, group Uncategorized separately, order
  by amount descending, and expose ties deterministically.
- **FR-080**: Planned/unplanned breakdown MUST use expense memos only. Purpose breakdown MUST state
  whether it covers income, expenses, or both; MVP default is expenses only.
- **FR-081**: Recent Money Memos MUST show the ten most recent included records by the history order
  and provide access to full history.
- **FR-082**: Monthly review MUST support a selected calendar month in the user's current timezone
  and show income, expenses, net movement, top five expense categories, total unplanned expenses,
  and expense purpose split per currency.
- **FR-083**: A completed selected month MAY compare with the immediately preceding completed month
  in the same currency using absolute change and `(selected - prior) / prior × 100` percentage.
- **FR-084**: Percentage comparison MUST be omitted with an explicit reason when the prior value is
  zero, absent, a different currency, or the selected period is incomplete.
- **FR-085**: All financial numbers in Home and monthly review MUST be deterministic application
  calculations reproducible from exported included memos and published period/inclusion rules.
- **FR-086**: Feature 001 MUST NOT generate an AI monthly narrative, recommendation, prediction,
  score, or behavioral insight.
- **FR-087**: Overview and review MUST show useful zero and insufficient-comparison states without
  fabricating categories, trends, or advice.

#### Privacy, Providers, Export, and Deletion

- **FR-088**: Cashmemo MUST NOT provide bank synchronization, direct banking connections, balance
  tracking, statement import, or dedicated fields for bank credentials, bank/account/routing
  numbers, card numbers, CVV/CVC, banking access tokens, statements, or government identifiers.
- **FR-089**: Every arbitrary text and voice entry surface MUST display a concise warning not to
  enter or speak prohibited banking/identity data before input begins.
- **FR-090**: Where content exists as text before persistence or onward AI processing, Cashmemo MUST
  apply a documented, versioned finite detector. Documented high-confidence matches MUST be blocked
  before persistence/onward AI processing while preserving local input for correction.
- **FR-091**: Detector behavior MUST publish covered pattern classes, known false positives, known
  false negatives, and correction behavior. Product copy and evidence MUST NOT claim complete
  semantic detection of arbitrary text or speech.
- **FR-092**: Because voice semantics are unknown before transcription, the pre-recording disclosure
  MUST state that temporary audio is sent to the configured speech-to-text provider and warn users
  not to speak prohibited data. Transcript detection MUST run before onward AI extraction.
- **FR-093**: User financial content—including amounts, notes, capture text, transcripts, audio,
  category/Money Space names, search terms, export contents, and provider payloads—MUST NOT appear in
  logs, traces, metrics, analytics, crash reports, support diagnostics, or test evidence.
- **FR-094**: Operational diagnostics MAY contain coarse event names, safe error codes, timings,
  provider identity, lifecycle state, and unlinked opaque correlation identifiers only when they
  cannot reconstruct user content or cross-user activity.
- **FR-095**: User content MUST be encrypted during network transit and in persistent live storage.
  Temporary local drafts MUST use platform-provided protected storage where available and disclose
  the shared-device risk where equivalent protection is unavailable.
- **FR-096**: Speech-to-text and AI providers MUST be replaceable product dependencies and MUST be
  approved only when contractual/configuration controls prohibit model training on Cashmemo data
  and provider-side retention can be disabled or bounded to the documented transient processing
  need.
- **FR-097**: Cashmemo MUST maintain a user-visible and operator-visible provider processing record:
  provider, data classes, purpose, region where known, retention, training use, subprocessors,
  deletion behavior, failure behavior, and last review date.
- **FR-098**: A material provider privacy/retention change MUST disable affected assisted capture
  until review and user disclosure are updated. Manual entry MUST remain available.
- **FR-099**: Export MUST produce a UTF-8 portable package with a versioned JSON source of truth and
  CSV convenience files for memos. It MUST include preferences, active/archived categories and Money
  Spaces, drafts, and active/archived/Recently Deleted memos with lifecycle timestamps.
- **FR-100**: Export MUST exclude password/authentication material, raw audio, provider payloads,
  internal secrets, suppression identifiers, telemetry, and unrelated operational metadata.
- **FR-101**: Export MUST represent one stated acceptance instant, preserve exact decimal amounts,
  currencies, occurrence instants/timezones, relationships, and lifecycle state, and fail as a whole
  rather than deliver an unlabeled partial package.
- **FR-102**: Account deletion MUST offer export, explain all deletion windows, require recent
  authentication and typed confirmation, then immediately revoke sessions and make all owned live
  data inaccessible.
- **FR-103**: Accepted account deletion MUST cancel transient audio/provider work, delete drafts and
  live user data within 24 hours under normal service availability, and prevent later provider
  callbacks or restored backups from recreating access.
- **FR-104**: Backups capable of containing deleted account or memo data MUST expire within 30 days.
  Restore procedure MUST reconcile accepted deletions before restored service becomes user-accessible.
- **FR-105**: Deletion work MUST be idempotent, restart automatically after recoverable failure, and
  generate privacy-safe overdue and service-level alerts. Infrastructure outage may delay physical
  deletion but MUST NOT restore logical access.
- **FR-106**: Discovery of prohibited data in arbitrary user-authored content MUST follow a
  documented privacy-incident process that avoids copying the content into tickets, telemetry, or
  evidence and supports deletion/correction by the owner.
- **FR-107**: Cashmemo MUST document the distinction among hard product guarantee, best-effort
  control, operational service level, and known limitation anywhere a privacy or deletion claim
  could otherwise be read as absolute.

#### Production Readiness and Evidence

- **FR-108**: Feature 001 is complete only when one production deployment provides real
  authentication, durable persistence, speech-to-text, structured AI extraction, export, deletion,
  and all user journeys without mock-only dependencies.
- **FR-109**: Cashmemo MUST be mobile-responsive and installable as a PWA with valid identity,
  icons, launch behavior, standalone display, update behavior, and clear recovery from an outdated
  client version.
- **FR-110**: MVP acceptance MUST cover current and previous major versions of mobile Safari and
  Chrome on supported iOS/Android devices plus current desktop Safari, Chrome, Firefox, and Edge.
- **FR-111**: All interactive journeys MUST meet WCAG 2.2 AA, support keyboard-only operation,
  visible focus, screen-reader names/status, sufficient contrast, reduced motion, and non-audio
  alternatives to voice capture.
- **FR-112**: Authenticated manual capture, history, overview, review, export request, and deletion
  request services MUST target 99.5% monthly availability excluding announced maintenance. Speech-
  to-text and AI availability are separately reported and do not reduce manual-path availability.
- **FR-113**: Cashmemo MUST provide privacy-safe observability for authentication outcomes, request
  health, latency, error class, provider availability, draft recovery, audio-deletion outcomes,
  export status, deletion backlog, backup age, and restore results without user financial content.
- **FR-114**: Production alerts MUST cover authentication outage, elevated protected-operation
  failures, cross-user authorization-denial anomalies, overdue audio, overdue deletion, provider
  outage, backup age, and failed restore/deletion reconciliation.
- **FR-115**: Production data MUST have automated backups with recovery point objective no greater
  than 24 hours, recovery time objective no greater than eight hours under the documented incident
  class, and maximum backup retention of 30 days.
- **FR-116**: A real restore procedure MUST be documented, exercised before MVP release, exercised
  at least quarterly afterward, verify deletion reconciliation and cross-user isolation, and record
  privacy-safe evidence of achieved recovery point and recovery time.
- **FR-117**: Configuration and operations documentation MUST cover environment requirements,
  secrets, identity callbacks, provider selection/privacy settings, deployment, rollback, backup,
  restore, audio cleanup, deletion reconciliation, incident response, and provider-disable fallback.
- **FR-118**: Release evidence MUST use production-equivalent services and configuration and MUST
  include real authentication, persistence, speech-to-text, AI extraction, PWA install, cross-user
  isolation, telemetry canaries, audio deletion, export consistency, account deletion, backup, and
  restore scenarios.
- **FR-119**: Required release gates are formatting, linting, type checking, unit tests, integration
  tests, privacy tests, security tests, accessibility tests, production-equivalent acceptance, and
  retained evidence. Every gate MUST pass before Feature 001 is production-usable.
- **FR-120**: Secrets MUST come from protected runtime configuration, never source or client-visible
  configuration, and automated secret scanning MUST block release on a detected credential.
- **FR-121**: Loading, empty, degraded, retrying, stale, conflict, unauthorized, rate-limited,
  validation, partial-section, and unrecoverable states MUST be explicitly represented for every
  critical journey and MUST preserve safe recovery actions.
- **FR-122**: Product documentation MUST state supported languages, currencies, browsers, service
  levels, provider limitations, deletion windows, export schema version, and support/privacy contact
  path at launch.

### Key Entities

- **User Account**: Authenticated owner of one isolated Cashmemo data scope; includes verification,
  lifecycle, session security, preferences, and deletion state, but no bank identity.
- **User Preferences**: Default currency, timezone, and display locale. Defaults new drafts and
  determines calendar-period grouping; never converts or mutates historical amounts.
- **Money Memo**: Authoritative confirmed income or expense event with exact amount/currency,
  occurrence instant/timezone, category, Money Space, purpose, planned status, optional note,
  lifecycle state, owner, revision, and lifecycle timestamps.
- **Capture Draft**: Non-authoritative, owner-scoped working state for manual, natural-language, or
  voice capture; may include editable fields, original text, transcript, provenance/ambiguity state,
  synchronization state, revision, expiry, and stable confirmation identity.
- **Temporary Audio**: Short-lived voice-processing input linked only to one draft; has creation,
  expiry, processing state, and deletion evidence but is never journal content or export data.
- **Category**: Owner-scoped organizational label, active/archive lifecycle, and memo references;
  not an accounting classification system.
- **Money Space**: Owner-scoped organizational context such as Personal, Work, Household, Freelance,
  Travel, or Project; explicitly not a financial account and contains no banking fields.
- **Export Snapshot**: Owner-requested, versioned, point-in-time portable package with status,
  acceptance instant, schema version, expiry, and whole-package success/failure.
- **Deletion Request**: Idempotent lifecycle record for memo or account deletion containing only
  minimum identifiers/state needed to make deletion survive retries, backups, and provider callbacks.
- **Monthly Summary**: Deterministic projection of included confirmed memos for one user, calendar
  month, timezone, and currency; not an independently editable financial record.
- **Provider Processing Record**: Reviewed description of provider data use and controls; contains no
  user payload or financial content.

### Calculation Rules

1. Period membership uses occurrence instant interpreted in user's current timezone at query time.
2. Active and archived confirmed memos are included; drafts and Recently Deleted/purged memos are
   excluded.
3. Income and expense are summed independently using exact stored decimal values per currency.
4. Net movement is income minus expenses for same currency and period.
5. Category, planned/unplanned, and purpose spending breakdowns use expense memos only.
6. Uncategorized expense is its own category. Archived labels retain historical display names.
7. Category ordering is amount descending, then normalized category name, then stable identifier.
8. Completed-month percentage change uses `(selected - prior) / prior × 100`; absent or zero prior
   values produce “comparison unavailable.”
9. Current incomplete month is labeled month-to-date and has no full-month comparison.
10. No rounding occurs before aggregation. Display rounding follows selected currency rules while
    exported exact values remain unchanged.

### Data Lifecycle

| Data class | Authoritative? | Normal retention | Deletion trigger/result |
|---|---:|---|---|
| Confirmed active/archive memo | Yes | Until user deletion/account deletion | Moves to Recently Deleted, then logical/physical deletion |
| Recently Deleted memo | No for totals; recoverable | 30 days | Restore or irreversible purge |
| Capture draft | No | 30 days since last edit | Confirmation, cancellation, expiry, or account deletion |
| Original typed capture text | No | Draft lifetime only | Confirmation unless copied to note, cancellation, expiry, account deletion |
| Transcript | No | Draft lifetime only | Confirmation unless copied to note, cancellation, expiry, account deletion |
| AI extraction metadata/output | No | Draft lifetime only | Confirmation, cancellation, expiry, account deletion |
| Raw audio | No | Maximum one hour | Success, cancellation, unrecoverable failure, account deletion, or expiry |
| Search query | No | Request lifetime only | Request completion/failure |
| Export package | Snapshot | Available to owner for 24 hours | Expiry, owner deletion, or account deletion |
| Live account data after accepted deletion | No access | Maximum 24-hour physical-deletion SLO under normal availability | Idempotent deletion and reconciliation |
| Backup copy | Disaster recovery only | Maximum 30 days | Retention expiry plus deletion reconciliation before restore access |
| Privacy-safe operational telemetry | No | 30 days unless shorter incident need | Scheduled expiry; never contains user financial content |

### Privacy Claim Classification

**Hard product guarantees**:

- No bank connection or dedicated sensitive banking/identity field exists.
- Cashmemo never intentionally requests, infers, or encourages prohibited data.
- Confirmed financial truth requires explicit user action; providers cannot alter it later.
- Raw audio is not journal/export/telemetry content and is governed by maximum one-hour lifecycle.
- User financial content is excluded from operational telemetry and normal evidence.
- Cross-user access fails closed.

**Best-effort controls**:

- Warnings on arbitrary text and voice surfaces.
- Published finite detection before persistence/onward processing where plaintext exists.
- Provider no-training/retention configuration and review.
- Privacy canaries and automated redaction/allowlisting.

**Operational service levels**:

- Temporary audio deletion events occur immediately when processing is available; one hour is the
  enforced maximum, with alert/retry evidence.
- Live physical memo/account deletion targets 24 hours under normal availability.
- Backup copies age out within 30 days; restore reconciliation prevents logical resurrection.
- Manual-path monthly availability target is 99.5%; backup RPO is 24 hours and documented RTO is
  eight hours for the stated incident class.

**Known limitations**:

- Arbitrary text or speech can contain prohibited data that warning or finite detection misses.
- Spoken content must reach speech-to-text before semantic detection.
- Infrastructure-wide outage may delay physical cleanup, observability, or recovery while logical
  deletion controls are designed to remain enforced after recovery.
- Provider and platform claims are bounded by reviewed contracts/configuration and evidence; they
  are not mathematically provable universal guarantees.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of representative first-time users complete registration, privacy review,
  preference setup, and first manual Money Memo without assistance in under five minutes.
- **SC-002**: At least 95% of representative users create a valid manual Money Memo in under 45
  seconds after opening capture.
- **SC-003**: At least 90% of representative English and Indonesian voice samples containing one
  clearly stated money event produce an editable draft within 20 seconds after recording stops
  under normal provider availability; accuracy is judged field-by-field before user correction.
- **SC-004**: 100% of assisted-capture acceptance runs require an explicit final confirmation and
  create no confirmed memo before that action.
- **SC-005**: Across 1,000 repeated delivery and timeout simulations per mutation class, each logical
  accepted request produces exactly one intended state transition and no duplicate memo.
- **SC-006**: Across 1,000 stale concurrent-edit simulations, no stale write silently overwrites a
  newer memo, category, Money Space, or draft revision.
- **SC-007**: 100% of recoverable network, speech-to-text, and AI failure acceptance scenarios retain
  typed/transcribed/user-edited content until user cancellation or documented expiry.
- **SC-008**: Home and monthly review reproduce hand-calculated exact totals, inclusion, ordering,
  and comparisons for 100% of reference datasets, including timezone, lifecycle, zero denominator,
  and multi-currency cases.
- **SC-009**: For an account with 10,000 memos, 95% of Home, history, search/filter, and monthly-review
  views become usable within two seconds under production-equivalent normal load.
- **SC-010**: 100% of cross-user access attempts in the protected-operation matrix disclose no
  record existence or content and cause no state change.
- **SC-011**: 100% of raw-audio lifecycle acceptance cases show deletion after successful
  transcription, cancellation, unrecoverable failure, account deletion, or one-hour expiry; no raw
  audio is present in backups, export, or telemetry scans.
- **SC-012**: Privacy-canary scans find zero amount, note, transcript, audio, category/Money Space,
  search, export, or provider-payload content in production-equivalent logs, traces, metrics,
  analytics, crash reports, support diagnostics, and retained evidence.
- **SC-013**: 100% of documented high-confidence detector fixtures are blocked at stated boundaries;
  labeled false-positive and false-negative results are published without claiming universal
  detection.
- **SC-014**: A complete export of 10,000 memos finishes within five minutes, validates against its
  published schema, contains one consistent snapshot, and preserves every exact reference value.
- **SC-015**: Accepted memo and account deletions make data inaccessible immediately, meet the
  24-hour live physical-deletion service level in at least 99.9% of monthly cases under normal
  availability, and prevent resurrection in 100% of restore acceptance scenarios.
- **SC-016**: 100% of backups expire within the stated 30-day maximum, and pre-release plus quarterly
  restore exercises meet RPO no greater than 24 hours and documented RTO no greater than eight hours.
- **SC-017**: Authenticated manual capture, history, overview, review, export request, and deletion
  request achieve at least 99.5% monthly availability excluding announced maintenance; AI/STT
  outages never block manual capture in acceptance evidence.
- **SC-018**: At least 90% of representative users successfully install or add the PWA and complete
  manual capture on each supported mobile browser/device class without horizontal scrolling or
  inaccessible controls.
- **SC-019**: Critical user journeys pass WCAG 2.2 AA automated checks and manual keyboard/screen-
  reader review with zero critical or serious accessibility defects at release.
- **SC-020**: Production-equivalent release evidence includes real identity, persistence, speech-to-
  text, AI, telemetry, export, deletion, backup, restore, and installability results; no integration
  requirement is closed solely by a mock.
- **SC-021**: All required release gates pass on the release candidate, all severity-critical/high
  security and privacy findings are closed or explicitly release-blocked, and every P1/P2 acceptance
  scenario has retained command/result evidence.
- **SC-022**: In a moderated study, at least 85% of representative users correctly explain that
  Money Spaces are not bank accounts, AI creates only drafts, raw audio is temporary, and manual
  capture remains available when assisted capture fails.

## Explicit MVP Completion Definition

Feature 001 is complete only when all following are true:

1. All eight user stories and acceptance scenarios work in production-equivalent and production
   environments using real identity, persistence, speech-to-text, and AI services.
2. Manual capture and confirmed-memo lifecycle remain usable when assisted providers are disabled.
3. Deterministic Home/monthly calculations match reference datasets exactly.
4. Export, memo deletion, account deletion, audio cleanup, bounded backup, and real restore evidence
   satisfy their stated lifecycle and service levels.
5. Cross-user isolation, telemetry privacy, provider controls, accessibility, mobile PWA, and
   documented operational runbooks pass release gates.
6. No P1/P2 acceptance scenario is closed by mock-only evidence where real integration is required.
7. C-07 governance is explicitly reconciled for this feature; no inherited old exception/task state
   is treated as approval.
8. Production deployment is reachable through its intended public entry point, monitored, backed
   up, recoverable, and documented for operation and rollback.

Unit tests alone, a local demo, mocked authentication/provider flows, or partially deployed
infrastructure do not satisfy Feature 001 completion.

## Explicitly Out of Scope

- Bank synchronization, direct banking connections, bank balances, account-number tracking, bank
  statement import, or banking credentials/tokens
- Payment processing, money transfer, cards, wallets, or merchant acquiring
- Investment tracking, trading, portfolio valuation, or autonomous financial advice
- Tax filing or tax preparation
- Full accounting, double-entry bookkeeping, invoicing, payroll, or reconciliation
- Currency conversion, exchange rates, or consolidated cross-currency valuation
- Advanced budgeting engine, envelopes, savings goals, forecasts, or irregular-income planning
- Recurring transactions, scheduled memos, reminders, or notification engine
- Receipt/statement OCR, attachment storage, or document ingestion
- Ask Cashmemo chatbot, AI monthly narrative, advanced behavioral insights, predictions, or scoring
- Native iOS/Android applications
- Family, team, shared finance, delegated access, or collaborative Money Spaces
- General-purpose offline history synchronization or automatic background conflict merging
- Data import/migration from banks or other finance products
- Microservices or independently deployed domain services

## Assumptions and Dependencies

- MVP serves individual adults journaling their own money events; no minor, business-admin, family,
  accountant, or team role exists.
- Registration initially uses email/password with verification and reset. Social login, passkeys,
  phone login, and enterprise SSO are deferred unless clarification changes this assumption.
- One memo has one currency. Multiple currencies are permitted but remain segregated in all totals.
- English and Indonesian assisted capture are launch requirements; UI display locale support may be
  narrower if all monetary/date meanings remain clear and accessibility is met.
- Users normally have network access. Limited local durability exists only to preserve current
  capture drafts/retry state, not to create an offline-first ledger.
- Users control what they type or speak. Cashmemo can discourage and detect declared patterns but
  cannot understand every arbitrary input before provider or storage boundaries.
- Production provider choice is deferred to planning, but provider privacy/retention requirements
  are product release gates.
- Operational service levels apply under documented normal-availability and incident assumptions;
  they are not guarantees during total infrastructure loss.
- Feature 001 launches without AI-generated monthly narrative; adding one requires a later
  specification with separate deterministic-versus-generated presentation and privacy review.

## Rejected Product Alternatives

- Treat Money Spaces as financial accounts: conflicts with product thesis and privacy boundary.
- Auto-save AI or speech output as confirmed truth: conflicts with trust and user control.
- Retain audio or transcripts for convenience: adds privacy exposure without core journal value.
- Disable manual capture during provider outage: makes accelerator availability control the product.
- Combine currencies using guessed or fetched rates: produces unsupported financial meaning.
- Promise complete detection of prohibited content in arbitrary speech/text: technically impossible.
- Expand Home into full dashboard, budgets, forecasts, or advice: violates MVP scope discipline.
- Optimize requirements around existing implementation: reverses product/spec authority.
