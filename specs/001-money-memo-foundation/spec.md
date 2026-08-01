# Feature Specification: Private Money Memo Foundation

**Feature Branch**: `001-money-memo-foundation`

**Created**: 2026-07-31

**Status**: Approved — corrected 2026-08-01

**Input**: User description: "Create Feature 001: Private Money Memo Foundation. Cashmemo is a privacy-first money journal. This feature establishes the complete manual Money Memo lifecycle without voice recording, STT, AI, bank connections, recurring entries, insights, or currency conversion."

## Clarifications

### Session 2026-07-31

- Q: Duplicate protection — replace the 24-hour idempotency record? → A: Durable creation
  identifier. The client generates a stable identifier per compose session; it lives on the
  memo permanently and is unique per user for the memo's whole life. No expiry window exists.
- Q: What survives a permanent deletion? → A: Nothing. The 90-day tombstone is removed
  entirely. A purged memo is indistinguishable from one that never existed. (Narrowed by the
  directed corrections below: a bounded purge ledger is now permitted for one stated purpose.)
- Q: How is the pagination guarantee scoped under concurrent change? → A: Complete exactly-once
  traversal applies only while result-set membership and ordering remain unchanged. Every page and
  continuation bind one result-set version. Creation, archive, restore, deletion, purge,
  occurrence-time edit, or current-query membership change invalidates continuation and requires
  refresh; membership-neutral non-sort edits preserve traversal.
- Q: What happens to a memo's captured UTC offset when its occurrence time is edited? → A: The
  memo keeps its original captured offset; the edit changes local wall time within that offset.
  Changing the zone is a separate explicit action.

### Session 2026-08-01

- Q: Can Cashmemo guarantee that arbitrary free text never contains sensitive banking data? → A:
  No. Cashmemo never requests, encourages, infers, or provides dedicated fields for prohibited
  banking data. Every free-text entry carries a clear warning, and a versioned, published
  best-effort detector warns or blocks documented high-confidence patterns. Cashmemo never claims
  complete semantic detection. Warned or blocked input remains an unsaved local draft with a clear
  correction path and never enters telemetry, analytics, inference, or crash reporting.
- Q: Is physical destruction within 24 hours unconditional during a total infrastructure outage?
  → A: No. Exact logical inaccessibility at the purge deadline is unconditional. Physical
  destruction within 24 hours is an operational SLO under normal service availability. Scheduled
  purge resumes automatically and idempotently after recovery; overdue records and SLO breaches
  alert operators. Access-triggered purge remains fallback only.

**Governance note**: The free-text correction conflicts with the literal universal wording of
Cashmemo Constitution v1.0.0 Principle I (“MUST NOT request, accept, transmit, or store” and every
capable input path “MUST reject”). It is therefore recorded as a Feature 001 constitution exception,
not silently treated as interpretation. Physical-purge SLO correction creates no constitution
exception because the constitution specifies explicit/tested deletion behavior but no 24-hour
outage-independent physical bound.

**Directed corrections (same session, applied after the questions above):**

1. **Creation fingerprint.** Retries are compared against an immutable fingerprint of the
   content submitted at creation, not against the live memo. A matching retry returns the
   memo's *current* version even after later edits. This resolves the earlier wrinkle where a
   legitimate retry arriving after an edit was rejected as a conflict.
2. **Purge is scheduled, not access-driven.** Inaccessibility is immediate at the deadline;
   physical destruction has a 24-hour operational SLO under normal service availability, with
   access-time purge only as a fallback. Scheduled purge resumes automatically and idempotently
   after an outage, overdue work and SLO breaches alert operators, backup retention is documented
   separately, and purged records must never return to the live system.
3. **Recently Deleted.** Ordinary lifecycle filters accept only active and archived.
   Pending-deletion memos live in a dedicated Recently Deleted view supporting restore and
   immediate permanent purge.

**Deliberate narrowing of the "nothing survives" decision**: correction 2 requires that a
restored backup cannot resurrect a purged memo. That is unenforceable against a backup taken
*before* the deletion request unless something records what was purged. FR-065 therefore
permits one bounded remnant containing exactly keyed `deletion_token`, `purged_at`, and
`removal_not_before_at`, with no financial content. Time only creates cleanup eligibility; entry is
destroyed after verified destruction of every backup capable of resurrection. This is the documented
operational purpose FR-064 requires; it is not a general-purpose tombstone.

**Numbering note**: functional requirements and success criteria were renumbered contiguously
during these revisions. No plan or task artifacts reference the old numbers.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a Money Memo (Priority: P1)

A user records money that moved. They pick income or expense, type an amount, pick a
currency, set when it happened, choose a category and a Money Space, optionally add a note,
mark it planned or unplanned, and set its purpose. On submit the memo becomes a confirmed
record in their journal.

**Why this priority**: Nothing else in the product exists without a recorded memo. This is
the single highest-value action and the smallest viable slice.

**Independent Test**: Fully testable by submitting a valid entry and observing that exactly
one confirmed memo exists with the submitted values; and by submitting invalid entries and
observing rejection with field-level feedback and no record created.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they submit type=expense, amount=42.50, currency=USD,
   occurrence=2026-07-30T19:15 in their zone, category=Groceries, space=Household,
   purpose=personal, planned=false, **Then** exactly one confirmed memo is created with those
   exact values and a creation timestamp.
2. **Given** a signed-in user, **When** they submit an amount of `0`, **Then** creation is
   rejected with a message identifying the amount field and the rule "amount must be greater
   than zero", and no record is created.
3. **Given** a signed-in user, **When** they submit an amount of `-42.50`, **Then** creation
   is rejected identifying the amount field and stating that direction is set by type
   (income/expense), not by sign, and no record is created.
4. **Given** a signed-in user, **When** they submit amount=10.555 with currency=USD (2 minor
   digits), **Then** creation is rejected identifying the amount field and the currency's
   allowed precision, and no record is created — the value is never silently rounded.
5. **Given** a creation request that timed out client-side, **When** the client retries with
   the same creation identifier and the same values, **Then** the original memo is returned
   and no second memo is created.
6. **Given** a memo created six months ago and never edited, **When** a request arrives bearing
   its creation identifier and the same original values, **Then** the existing memo is returned
   and no second memo is created — duplicate protection does not expire.
7. **Given** a memo created yesterday whose amount the user has since corrected from 42.50 to
   45.00, **When** a delayed retry arrives bearing that memo's creation identifier and the
   *original* values (42.50), **Then** the retry matches the creation fingerprint and the memo
   is returned **as it stands now, showing 45.00** — the retry neither conflicts nor reverts
   the correction.
8. **Given** any memo, **When** a request arrives bearing its creation identifier but content
   that does not match the creation fingerprint, **Then** the request is rejected as a conflict
   naming the existing memo, nothing is written, and the memo is unchanged.
9. **Given** a stored creation fingerprint, **When** the stored record is inspected directly,
   **Then** it contains no readable amount and no readable note text, and the original values
   cannot be determined or confirmed from it.
10. **Given** a user who genuinely bought the same coffee twice, **When** they compose and
    submit two memos with identical field values from two compose sessions, **Then** two
    distinct memos exist.
11. **Given** a memo the user archived, **When** a delayed retry arrives bearing its creation
    identifier and matching original content, **Then** the memo is returned showing its
    archived status and is not silently reactivated.
12. **Given** a creation request missing category, **When** submitted, **Then** it is rejected
   listing every missing required field in one response, not one field at a time.
13. **Given** any free-text entry, **When** it is displayed, **Then** a clear adjacent warning
    says not to enter bank credentials, account or card details, banking tokens, bank statements,
    or government identifiers.
14. **Given** unsaved note text that matches a blocking pattern in the published detector,
    **When** the user submits it, **Then** creation is blocked without echoing the value, the full
    unsaved note remains available locally, and the user is told how to correct and retry it.
15. **Given** unsaved text that triggers a detector warning or block, **When** client, server,
    telemetry, analytics, and crash-reporting captures are inspected, **Then** the text and every
    derivative of the match are absent; only the synchronous in-memory detector examined it.

---

### User Story 2 - List and view Money Memos (Priority: P1)

A user opens their journal and sees their confirmed memos in a predictable order, pages
through them, and opens any single memo to see its full detail.

**Why this priority**: A write-only journal has no value. Paired with US1 this is the MVP.

**Independent Test**: Testable by seeding memos for two different users, then listing and
opening as each user; verify ordering, page boundaries, the results-changed signal, and that
neither user can see or reach the other's records.

**Acceptance Scenarios**:

1. **Given** a user with 130 active memos, **When** they open the default list, **Then** they
   receive the first 50 in occurrence-time-descending order with a position marker for the
   next page.
2. **Given** three memos sharing the exact same occurrence timestamp, **When** listed twice,
   **Then** both listings return them in the identical order (tie-broken by creation timestamp
   descending, then by memo identifier descending).
3. **Given** a user paging through their journal, **When** a memo is created, archived, restored,
   requested for deletion, reaches its purge deadline, is purged, or has its occurrence time
   edited between page requests,
   **Then** the result-set version changes, the continuation page is discarded, and the user is
   required to refresh; a purged or expired memo is never returned to satisfy cursor history.
4. **Given** a user paging through their journal, **When** a memo's occurrence time is changed
   between page requests so that it crosses the current page position, **Then** the system
   detects that the result set shifted and tells the user results changed, offering a refresh
   — it does not present the shifted set as complete.
5. **Given** user A holding the identifier of user B's memo, **When** user A requests it,
   **Then** the response is indistinguishable from a request for a memo that does not exist.
6. **Given** a user with zero memos, **When** they open the list, **Then** they see an empty
   state, not an error.
7. **Given** a user with archived and pending-deletion memos, **When** they open the default
   list, **Then** only active memos appear.
8. **Given** a user requesting a page size of 500, **When** submitted, **Then** the request is
   rejected stating the maximum of 200 — the value is not silently reduced.

---

### User Story 3 - Edit a Money Memo (Priority: P2)

A user corrects a memo they already recorded — a wrong amount, a wrong category, a note they
forgot to add. Their correction must not silently overwrite a change made elsewhere, and a
rejected save must never cost them their typing.

**Why this priority**: Manual entry produces mistakes. Correction is required for the journal
to stay trustworthy, but the journal is already useful before editing exists.

**Independent Test**: Testable by editing a memo from a single session (happy path), and by
simulating two sessions editing the same memo to verify conflict rejection and recovery.

**Acceptance Scenarios**:

1. **Given** a memo at revision 3, **When** the user submits an edit stating revision 3,
   **Then** the edit is applied and the memo advances to revision 4 with an updated
   last-update timestamp.
2. **Given** a memo advanced to revision 4 by another session, **When** a user submits an edit
   stating revision 3, **Then** the write is rejected as a conflict, no field is changed, and
   the response carries the current server state.
3. **Given** a rejected conflicting edit, **When** the user returns to the editor, **Then**
   their unsaved input is still present alongside the current server values, and they can
   re-apply, discard, or merge.
4. **Given** a user editing a USD memo, **When** they change currency to EUR, **Then** the
   amount value is not converted, and the change is only accepted after an explicit
   confirmation stating that the amount is being re-declared, not converted.
5. **Given** a user who has already confirmed one currency change, **When** they change
   currency again on any memo, **Then** the confirmation is required again — it cannot be
   suppressed, remembered, or waived.
6. **Given** a stale submission that changes amount and currency together, **When** submitted,
   **Then** it is rejected as a conflict and neither the amount nor the currency is applied —
   the submission is applied whole or not at all.
7. **Given** a memo whose occurrence time was recorded at UTC+09:00, **When** a user in a
   UTC+01:00 zone edits the time from 19:15 to 19:45, **Then** the memo reads 19:45 at
   UTC+09:00 — the captured offset is unchanged and the memo does not shift by eight hours.
8. **Given** that same memo, **When** the user explicitly changes its zone to UTC+01:00,
   **Then** the displayed wall time stays 19:45 and the underlying instant moves accordingly.
9. **Given** any memo, **When** it is edited any number of times, **Then** its creation
   fingerprint is unchanged — the fingerprint records what was submitted at creation and is
   never recomputed.
10. **Given** a memo, **When** a user attempts to change its creation timestamp, its owner, its
    revision, its creation identifier, its creation fingerprint, or its lifecycle status
    through the edit path, **Then** the attempt is rejected — these are not editable fields.
11. **Given** an edit request that fails on network transmission, **When** the user reopens the
    editor, **Then** their unsaved input is recoverable and no partial change was applied.
12. **Given** an archived or pending-deletion memo, **When** a user attempts to edit its
    fields, **Then** the edit is rejected with a message stating the restore step required.

---

### User Story 4 - Archive and restore (Priority: P2)

A user clears finished or irrelevant memos out of their active view without destroying them,
reviews the archive later, and pulls any memo back.

**Why this priority**: Gives users a safe alternative to deletion, which reduces irreversible
data loss. Depends on list and view existing.

**Independent Test**: Testable by archiving a memo, confirming it disappears from the active
list, appears in the archived view, and returns to the active list on restore.

**Acceptance Scenarios**:

1. **Given** an active memo, **When** the user archives it, **Then** its lifecycle status
   becomes archived, its last-update timestamp changes, and no field data is altered.
2. **Given** an archived memo, **When** the user opens the default active list, **Then** the
   memo is absent.
3. **Given** an archived memo, **When** the user opens the archived view, **Then** the memo is
   present with all its original values intact.
4. **Given** an archived memo, **When** the user restores it, **Then** its lifecycle status
   returns to active and it reappears in the active list.
5. **Given** an already-archived memo, **When** an archive request is retried, **Then** the
   result is success with no change and no error (archive is idempotent).
6. **Given** a memo in Recently Deleted, **When** a user attempts to archive it, **Then** the
   request is rejected with a message stating it must be restored first.

---

### User Story 5 - Permanently delete (Priority: P3)

A user destroys a memo for good. The action is explicit. The memo moves to Recently Deleted,
where it stays recoverable for a stated window. At the deadline it becomes unreachable at once
and is physically destroyed shortly after, and it never comes back.

**Why this priority**: Required by data ownership, but lower frequency than archiving and
safely deferrable behind archive.

**Independent Test**: Testable by requesting deletion, confirming the memo leaves every
ordinary surface and appears in Recently Deleted, restoring it, and separately verifying that a
memo past its deadline is unreachable at once, meets the 24-hour physical-destruction SLO under
normal service availability, resumes purge after an outage, and remains absent after backup
restore.

**Acceptance Scenarios**:

1. **Given** a memo, **When** the user requests permanent deletion, **Then** they must pass a
   destructive confirmation distinct from archive before the request is accepted.
2. **Given** an accepted deletion request, **When** it takes effect, **Then** the memo enters
   pending-deletion status with a purge deadline 30 days out, and it is excluded from the
   active list, the archived view, every ordinary list, search, filters, and every export.
3. **Given** a memo pending deletion, **When** the user opens Recently Deleted, **Then** the
   memo is listed with its purge deadline, using the same ordering and paging rules as the
   active list.
4. **Given** a memo in Recently Deleted, **When** the user restores it, **Then** it returns to
   the lifecycle status it held before deletion was requested, with all field values intact.
5. **Given** a memo in Recently Deleted, **When** the user chooses immediate permanent purge
   and passes a second explicit confirmation, **Then** the memo is purged without waiting for
   the deadline.
6. **Given** a memo already pending deletion, **When** another deletion request arrives,
   **Then** it succeeds with no change and the purge deadline is unchanged — repeated requests
   never extend or reset the window.
7. **Given** a memo in Recently Deleted, **When** the user attempts to edit its fields, **Then**
   the edit is rejected with a message naming the restore step required.
8. **Given** a memo whose purge deadline has just passed, **When** any path requests it —
   ordinary list, Recently Deleted, direct read, search, filter, export, or restore — **Then**
   it is already unreachable, regardless of whether any scheduled process has run.
9. **Given** a memo whose purge deadline has passed and the purge execution path remains normally
   available, **When** 24 hours have elapsed, **Then** the scheduled process has physically
   destroyed the record under the operational SLO; physical destruction does not wait for anyone
   to access it.
10. **Given** a memo past its deadline that the scheduled process has not yet reached, **When**
    any access attempt touches it, **Then** it is physically purged at that moment as a
    fallback — the fallback supplements the scheduled process and never replaces it.
11. **Given** a purged memo, **When** the live system is inspected for anything about it,
    **Then** nothing is found beyond a purge-ledger entry containing exactly keyed/non-reversible
    `deletion_token`, `purged_at`, and `removal_not_before_at` — no owner/raw memo reference,
    amount, currency, note, category, Money Space, purpose, date, creation identifier, creation
    fingerprint, or search-support entry.
12. **Given** a backup taken before a memo was deleted, **When** that backup is restored,
    **Then** the purged memo does not become reachable in the live system — the restore
    reconciles against the purge ledger before any data is served.
13. **Given** a backup containing a memo that was already pending deletion with an expired
    deadline, **When** that backup is restored, **Then** the memo is unreachable immediately
    and is physically destroyed by the next scheduled pass.
14. **Given** a purged memo after `removal_not_before_at`, **When** every capable backup is verified
    destroyed, **Then** the purge-ledger entry is removed; if destruction cannot be verified, the
    entry remains, an alert is raised, verification retries, and cleanup stays blocked.
15. **Given** a purged memo's identifier, **When** it is requested, **Then** the response is
    identical to a request for an identifier that was never issued.
16. **Given** purge infrastructure is unavailable across a deadline or beyond the 24-hour SLO,
    **When** availability returns, **Then** the scheduled process automatically and idempotently
    destroys every overdue record, emits no sensitive identifier, and retained operational
    evidence proves outage detection, SLO-breach alerting, and recovery completion.

---

### User Story 6 - Search and filter (Priority: P3)

A user narrows their journal down to what they are looking for — by words in the note, or by
any combination of date range, type, currency, category, Money Space, planned status, purpose,
and lifecycle status.

**Why this priority**: Value grows with journal size. A new user with 20 memos does not need
it; a user with 2,000 does.

**Independent Test**: Testable by seeding a known memo set for two users, applying each filter
and each combination, and asserting exact result sets, zero cross-user leakage, and zero search
terms in any diagnostic output.

**Acceptance Scenarios**:

1. **Given** memos with notes "Lunch with Ana" and "Bus fare", **When** the user searches
   "lunch", **Then** only the first is returned (search is case-insensitive).
2. **Given** a memo with the note "Café", **When** the user searches "cafe", **Then** the memo
   is returned (search is diacritic-insensitive).
3. **Given** a memo in the category "Groceries" whose note does not contain that word, **When**
   the user searches "groceries", **Then** the memo is not returned — category and Money Space
   are filter dimensions, not free-text search targets.
4. **Given** any search term, **When** results are produced, **Then** they contain only memos
   owned by the requesting user — verified with a seeded second user whose memos match the
   same term.
5. **Given** filters type=expense AND currency=USD AND space=Work, **When** applied, **Then**
   only memos matching all three are returned (filters combine with AND).
6. **Given** a date-range filter of 2026-07-01 to 2026-07-31, **When** applied, **Then**
   inclusion is decided by each memo's occurrence date as recorded in that memo's own captured
   offset, so a memo the user entered as "July 31, 11pm" is included regardless of the viewer's
   current zone.
7. **Given** two memos recorded at the same instant but with different captured offsets that
   place them on different local dates, **When** a single-day filter is applied, **Then** only
   the one whose own local date matches is returned — this is intended, because the filter
   answers what the user spent on their July 31.
8. **Given** a filter combination matching nothing, **When** applied, **Then** an empty result
   is returned, not an error.
9. **Given** a lifecycle filter of archived, **When** applied, **Then** archived memos are
   returned and no pending-deletion memo is.
10. **Given** a lifecycle filter naming pending deletion, **When** submitted, **Then** it is
    rejected as an invalid filter value stating that only active and archived are accepted —
    pending-deletion memos are reachable only through Recently Deleted.
11. **Given** any search, **When** it succeeds or fails, **Then** the search term appears in no
    log, trace, analytics event, crash report, or error message.
12. **Given** a search with an active filter set, **When** the user pages through results,
    **Then** ordering, paging, and the results-changed signal behave exactly as in the
    unfiltered list.

---

### User Story 7 - Export (Priority: P4)

A user takes their journal with them, in a documented format that another program can read
without guessing, capturing one consistent moment in time.

**Why this priority**: Last in build order, but it is a standing obligation of the product
(Constitution Principle V) and MUST ship within this feature, not after it.

**Independent Test**: Testable by exporting a seeded memo set and asserting the output parses,
round-trips every documented field, reflects a single instant, carries no internal metadata,
and contains no other user's records.

**Acceptance Scenarios**:

1. **Given** a user with active and archived memos, **When** they export with default options,
   **Then** the file contains their active memos only, and archived memos are excluded.
2. **Given** the same user, **When** they export with "include archived" selected, **Then**
   the file contains both active and archived memos, each labelled with its lifecycle status.
3. **Given** any export, **When** it is produced, **Then** memos in Recently Deleted are never
   included, with or without any option selected, and purged memos cannot appear because their
   data no longer exists.
4. **Given** an export in preparation, **When** a memo is edited, archived, restored, or
   deleted before the file is delivered, **Then** the file reflects the state at the instant
   the export was accepted — it never mixes pre-change and post-change versions.
5. **Given** an export that cannot be produced from a single consistent instant, **When**
   attempted, **Then** it fails and reports the failure — no partial and no mixed file is
   delivered.
6. **Given** a memo of 42.50 USD, **When** exported, **Then** the amount is represented
   without loss — its exact decimal value, its currency code, and its minor-unit scale — so no
   reader can misread the magnitude.
7. **Given** a memo of 1000 JPY (zero minor digits) and a memo of 1.500 BHD (three minor
   digits), **When** exported, **Then** each carries its own correct scale.
8. **Given** any exported memo, **When** its occurrence time is read, **Then** it carries both
   the exact instant and the captured UTC offset, so the user's intended local date is
   reconstructible.
9. **Given** any export, **When** its fields are inspected, **Then** it contains no revision
   number, no creation identifier, no creation fingerprint, no owner reference, no
   page-position data, and no deletion or purge-ledger metadata — only fields the user needs.
10. **Given** an export request by user A, **When** produced, **Then** it contains zero records
    belonging to any other user.
11. **Given** a user with 10,000 memos, **When** they request an export, **Then** they receive
    a complete file — the export is never silently truncated, and any inability to complete is
    reported as a failure rather than a partial file.

---

### User Story 8 - Manage categories and Money Spaces (Priority: P2)

A user shapes the labels their journal is organized by. They add a category or Money Space,
rename one, retire one they no longer use without disturbing the memos that reference it,
bring a retired one back, and delete one outright when nothing points at it.

**Why this priority**: US1 works against a seeded starter set, so creation is not blocked. But
a journal whose labels the user cannot change stops matching their life within weeks, and the
reference rules here decide whether historical memos keep their meaning.

**Independent Test**: Fully testable on its own by creating, renaming, deactivating,
reactivating, and deleting labels and observing picker contents, memo displays, filter values,
and deletion refusals — no memo-editing capability required beyond reading memos.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they create a Money Space named "Freelance", **Then**
   it becomes available in pickers for new memos and as a filter value.
2. **Given** an existing category "Grocery", **When** the user renames it to "Groceries",
   **Then** every memo referencing it displays the new name, no memo is detached, and no
   second category is created.
3. **Given** a user with an active category "Travel", **When** they attempt to create another
   category named "travel", **Then** it is rejected — names are unique per user per kind,
   compared without regard to case.
4. **Given** a deactivated Money Space "Project X", **When** the user attempts to create a new
   Money Space with that name, **Then** it is rejected and the user is offered reactivation
   instead.
5. **Given** a category referenced by at least one memo, **When** the user requests permanent
   deletion, **Then** it is refused, the refusal states that memos reference it, and
   deactivation is offered instead.
6. **Given** a category referenced only by an archived memo and a memo in Recently Deleted,
   **When** permanent deletion is requested, **Then** it is still refused — archived and
   pending-deletion memos count as references.
7. **Given** a category referenced by no memo at all, **When** the user confirms permanent
   deletion, **Then** it is deleted and the action is irreversible.
8. **Given** a Money Space the user deactivates, **When** they open the picker while creating
   a new memo, **Then** the deactivated Money Space is absent from the picker.
9. **Given** a memo that references a deactivated Money Space, **When** the user views that
   memo, **Then** the Money Space name is still displayed exactly as before.
10. **Given** that same memo, **When** the user edits its amount and saves, **Then** the edit
    succeeds and the memo keeps its deactivated Money Space — the user simply cannot newly
    select a deactivated one.
11. **Given** a deactivated category, **When** the user filters by it, **Then** the memos that
    reference it are returned — deactivation removes it from pickers, not from filters.
12. **Given** a deactivated category, **When** the user reactivates it, **Then** it returns to
    pickers with every memo that referenced it still attached.

---

### Edge Cases

- **Amount at bounds**: amount exactly at the maximum (999,999,999,999 major units) is
  accepted; one minor unit above is rejected with a bound message.
- **Amount formatting**: values submitted with grouping separators or a locale decimal comma
  are normalized before validation, or rejected with a clear format message — never silently
  reinterpreted (e.g. `1,500` must not become `1.5`).
- **Unsupported currency**: an unrecognized currency code is rejected; the memo is not created.
- **Future occurrence date**: accepted — a user may record a planned expense dated ahead. Dates
  more than 10 years in the future or past are rejected as likely typos.
- **Daylight-saving ambiguity**: a memo recorded at a local time that occurs twice on a
  fall-back day resolves to the offset in effect at that instant, which is stored on the memo.
  It never resolves differently on a later read.
- **User travels zones**: a memo recorded in one zone keeps its captured offset forever. New
  memos capture the new zone's offset. Switching the display toggle changes what is shown and
  changes nothing that is stored or filtered.
- **Occurrence edited from another zone**: the captured offset is untouched; only the local
  wall time changes. Moving a memo to a different zone is a separate, explicit action that
  preserves the displayed wall time and moves the instant.
- **Note at limit**: a note of exactly 1,000 characters is accepted; 1,001 is rejected with a
  count, and the text is never truncated silently.
- **Empty note**: omitted and empty-string notes are both stored as "no note" and are
  indistinguishable afterwards.
- **Retry after an edit**: matches the creation fingerprint (which records the original
  submission) and returns the memo's current, edited version. The edit is never reverted and no
  conflict is raised.
- **Retry after several edits**: same outcome. The fingerprint is written once at creation and
  no edit recomputes it, so the retry horizon is unaffected by how much the memo has changed.
- **Creation identifier reused with non-matching content**: rejected as a conflict naming the
  existing memo. Nothing is written and the existing memo is untouched.
- **Creation identifier reused after purge**: the identifier and its fingerprint went with the
  memo, so a later request bearing it creates a new memo. Safe because purge requires an
  explicit user action plus either a 30-day wait or a second destructive confirmation, and no
  client retry horizon reaches that far.
- **Fingerprint over a small value space**: amounts, currencies, and dates have few plausible
  values, so a fingerprint that can be recomputed by an observer would leak them. The
  fingerprint must resist confirmation by exhaustive guessing, not merely avoid storing
  plaintext.
- **Search term at minimum**: a one-character term is rejected with the minimum stated; a term
  that is only whitespace is treated as no term at all, not as a match-everything query.
- **Lifecycle filter given an unsupported value**: rejected as invalid, naming the accepted
  values, rather than silently returning nothing.
- **Page position validity**: a malformed, tampered, or expired page position is rejected with
  a clear message rather than silently returning page one.
- **Page size out of range**: a requested page size above the maximum is rejected with the
  maximum stated, rather than silently clamped.
- **Result set changed mid-pagination**: creation, archive, restore, deletion request,
  purge-deadline crossing, purge, occurrence-time edit, or any edit that changes membership in the current normalized query
  changes the result-set version. The user is told the result set changed and offered a refresh.
  A non-sort-key edit that leaves current-query membership unchanged preserves traversal. The
  system never presents a changed set as complete.
- **Repeated deletion request**: succeeds with no change; the purge deadline set by the first
  accepted request stands.
- **Deadline passes while the scheduled process is down**: the memo is unreachable from the
  deadline instant regardless. Physical destruction is delayed until the process recovers or
  until an access attempt triggers the fallback purge, whichever comes first. Scheduled purge
  resumes automatically and idempotently after recovery. Missing scheduler heartbeats, overdue
  work, and every 24-hour SLO breach alert operators and produce privacy-safe operational evidence.
- **Purge during an open detail view**: the next interaction returns the same response as for
  a memo that never existed, with a clear message, not a blank screen.
- **Backup restored from before a deletion**: reconciliation against the purge ledger runs
  before any restored data is served, so the purged memo never becomes reachable.
- **Backup restored containing an expired pending-deletion memo**: the memo is unreachable
  immediately on its own expired deadline and is destroyed by the next scheduled pass.
- **Purge ledger entry cleanup**: passing `removal_not_before_at` alone changes nothing. Once that
  time has passed and every backup capable of containing the memo is verified destroyed, the entry
  is removed. Failed verification retains it, alerts, retries, and blocks cleanup.
- **Restore of a memo whose category was deactivated meanwhile**: the memo is restored intact
  and still displays that category.
- **Export while memos change**: the export reflects the instant it was accepted; later changes
  are absent, and no memo appears in two versions.
- **Potential prohibited data entered in free text**: a clear adjacent warning is already visible.
  A documented blocking-pattern match prevents submission; a warning-pattern match provides a
  correction path. Either outcome preserves the unsaved local value while keeping that value and
  match derivatives out of logs, traces, analytics, inference, and crash reports. False positives
  and false negatives remain possible outside the exact published pattern set, and Cashmemo makes
  no complete-semantic-detection claim.
- **Search failure**: reports that the search failed without naming the term or any memo
  content, in the response or in any diagnostic record.

## Requirements *(mandatory)*

### Functional Requirements

#### Money Memo content and validation

- **FR-001**: System MUST record a Money Memo with exactly these user-set fields: type
  (income or expense), amount, currency, occurrence date and time, category, Money Space,
  optional note, planned status (planned or unplanned), and purpose (personal, work, or mixed).
- **FR-002**: System MUST record for every memo, without user input: owner identity, lifecycle
  status, revision number, creation identifier, creation fingerprint, creation timestamp, and
  last-update timestamp.
- **FR-003**: System MUST require type, amount, currency, occurrence date and time, category,
  Money Space, planned status, and purpose. Note is the only optional user-set field.
- **FR-004**: System MUST reject an amount of zero or less. Direction is expressed solely by
  type; a signed amount MUST NOT be accepted as a way to express direction.
- **FR-005**: System MUST reject an amount whose decimal precision exceeds the minor-unit
  precision of its currency, and MUST NOT round the value silently.
- **FR-006**: System MUST reject amounts above 999,999,999,999 major units.
- **FR-007**: System MUST accept only currency codes from a documented supported list, each
  with a declared minor-unit precision.
- **FR-008**: System MUST reject notes longer than 1,000 characters and MUST NOT truncate a
  note silently.
- **FR-009**: System MUST return all validation failures for a single submission together, each
  naming the offending field and the rule violated.
- **FR-010**: System MUST apply the versioned, published prohibited-data Pattern Set v1 to every
  free-text trust boundary. It MUST block blocking-class matches, surface warning-class matches
  with a correction path, state the affected field and rule without echoing the value, preserve
  the exact unsaved input locally after either outcome, and keep the input and match derivatives
  out of logs, traces, metrics, analytics, inference, and crash reports. A blocking-class value MUST
  NOT persist. A warning-only value MUST remain unsaved until the user edits, removes, or explicitly
  continues with it; continuing creates no stored attestation. Only synchronous in-memory detector
  evaluation may examine candidate content before that choice. The product MUST document known
  false-positive and false-negative behavior and MUST NOT claim complete semantic detection.

#### Time and time zones

- **FR-011**: System MUST store each memo's occurrence as an exact instant together with the
  UTC offset in effect where and when the user recorded it. Every API and export instant MUST use
  canonical UTC `YYYY-MM-DDTHH:mm:ss.SSSSSSZ`. Occurrence offsets MUST be within `-14:00` through
  `+14:00`; at either 14-hour extreme only `14:00` is valid, so `+14:01` through `+14:59` and
  `-14:01` through `-14:59` MUST be rejected.
- **FR-012**: System MUST display a memo's occurrence in its own captured offset by default,
  and MUST offer a display toggle showing the viewer's current zone.
- **FR-013**: System MUST ensure that changing the display toggle, or the viewer's device zone
  changing, alters no stored value and changes no filter result.
- **FR-014**: System MUST preserve a memo's captured offset when its occurrence time is edited.
  The edit changes the local wall time within the original offset.
- **FR-015**: System MUST treat changing a memo's zone as a separate, explicit action. When the
  user changes the zone, the displayed wall time is preserved and the stored instant moves
  accordingly.
- **FR-016**: System MUST evaluate date-range filters against each memo's local date in that
  memo's own captured offset. Two memos recorded at the same instant with different captured
  offsets MAY therefore fall on different filter dates; this is the intended behavior.
- **FR-017**: System MUST resolve a daylight-saving-ambiguous local time to exactly one instant
  at recording time, fixed by the captured offset, and MUST NOT reinterpret it on later reads.
- **FR-018**: System MUST record creation and last-update timestamps as exact instants and MUST
  never allow a user to set them.
- **FR-019**: System MUST reject occurrence dates more than 10 years in the past or future.

#### Creation and duplicate protection

- **FR-020**: System MUST require a client-generated creation identifier on every creation
  request, stable for the duration of one compose session.
- **FR-021**: System MUST store the creation identifier on the created memo and MUST enforce
  its uniqueness per user for the memo's entire life. No expiry window applies.
- **FR-022**: System MUST store, with each memo, an immutable creation fingerprint derived from
  the field values exactly as submitted at creation. The fingerprint MUST be written once and
  MUST NOT be recomputed, updated, or invalidated by any later edit.
- **FR-023**: System MUST NOT store submitted amount or note values in plaintext within the
  creation fingerprint, and MUST NOT allow an observer holding the fingerprint to determine or
  confirm the original values — including by exhaustive guessing over the small space of
  plausible amounts, currencies, and dates.
- **FR-024**: System MUST, when a creation request bears a creation identifier already held by
  one of that user's memos and its content matches that memo's creation fingerprint, return the
  memo **in its current state** and create nothing new — regardless of how much time has passed
  and regardless of any edits made since creation. The memo is returned with its current
  lifecycle status; a retry matching a memo that is archived or pending deletion MUST report
  that status and MUST NOT change it.
- **FR-025**: System MUST reject a creation request bearing an existing creation identifier
  whose content does not match that memo's creation fingerprint, as a conflict naming the
  existing memo, changing nothing.
- **FR-026**: System MUST compare retries against the stored creation fingerprint only. It MUST
  NOT compare a retry against the memo's current field values, and MUST NOT retain a separate
  plaintext copy of the submitted content for comparison.
- **FR-027**: System MUST create two distinct memos when two compose sessions submit identical
  field values under different creation identifiers.
- **FR-028**: System MUST destroy a memo's creation identifier and creation fingerprint when
  the memo is purged; a later request bearing that identifier creates a new memo.
- **FR-029**: System MUST treat a manually submitted memo as user-confirmed at submission. This
  feature MUST NOT persist any server-side unconfirmed draft record.

#### Reading, ordering, and pagination

- **FR-030**: System MUST order lists by occurrence time descending, tie-broken by creation
  timestamp descending, then by memo identifier descending, producing a total order.
- **FR-031**: System MUST express a page position as a position within that total order, never
  as a numeric offset into the result set.
- **FR-032**: System MUST guarantee complete exactly-once traversal across a paging sequence only
  while result-set membership and ordering remain unchanged. Every page MUST carry one
  caller-visible result-set version; every subsequent cursor request MUST supply the version it
  received, and the protected cursor MUST bind the same version. Creation, archive, restore,
  deletion request, purge-deadline crossing, purge, occurrence-time edit, or any edit that changes membership in the
  current normalized query MUST change that version. A mismatched version MUST discard the page,
  return a results-changed response, and require refresh. A non-sort-key edit that leaves
  current-query membership unchanged MUST preserve the version and traversal. Purged and expired
  records remain governed by FR-060 and MUST NOT be returned to satisfy cursor history.
- **FR-033**: System MUST, when a memo's occurrence time changes mid-pagination such that the
  result set shifts across the current page position, detect the shift and inform the user that
  results changed, offering a refresh. The system MUST NOT present a shifted set as complete.
- **FR-034**: System MUST default to 50 memos per page and MUST reject a requested page size
  above 200 rather than clamping it silently.
- **FR-035**: System MUST reject a malformed, tampered, or expired page position with a clear
  message.
- **FR-036**: System MUST exclude archived and pending-deletion memos from the default active
  list and from every other ordinary list.
- **FR-037**: System MUST allow a user to open any single memo they own and see every field.

#### Editing and stale writes

- **FR-038**: System MUST allow a user to edit type, amount, currency, occurrence date and
  time, memo zone, category, Money Space, note, planned status, and purpose on an active memo.
- **FR-039**: System MUST reject edits to owner, creation timestamp, creation identifier,
  creation fingerprint, revision, and lifecycle status through the edit path; lifecycle changes
  go through archive, restore, and delete.
- **FR-040**: System MUST require the client to state the revision it read, and MUST reject the
  submission with a conflict when that revision is not current, leaving every field unchanged.
- **FR-041**: System MUST include the current server state in a conflict response so the client
  can present current values alongside the user's input.
- **FR-042**: System MUST preserve the user's unsaved input on conflict or network failure and
  MUST offer re-apply, discard, and merge as recoverable paths.
- **FR-043**: System MUST increment a memo's revision and update its last-update timestamp on
  every successful edit.
- **FR-044**: System MUST allow currency to change after creation and MUST NOT convert the
  amount under any circumstance.
- **FR-045**: System MUST require an explicit confirmation, stating that the amount is being
  re-declared rather than converted, on every currency change to an existing memo. The
  confirmation MUST NOT be suppressible, remembered, or waivable. It does not apply to the
  initial choice of currency at creation, which is not a change.
- **FR-046**: System MUST apply an edit submission whole or not at all. A submission changing
  amount and currency together MUST apply both or neither, and a stale submission MUST apply
  neither.
- **FR-047**: System MUST reject field edits on archived and pending-deletion memos, naming the
  restore step required.

#### Lifecycle: archive, restore, delete, purge

- **FR-048**: System MUST support exactly these lifecycle statuses: active, archived, and
  pending deletion. Purge is not a status — a purged memo ceases to exist.
- **FR-049**: System MUST let a user archive an active memo and restore an archived memo, with
  no change to any field value in either direction.
- **FR-050**: System MUST treat repeated archive and repeated restore requests as idempotent
  successes.
- **FR-051**: System MUST make archived memos reachable through a dedicated archived view.
- **FR-052**: System MUST require an explicit destructive confirmation, distinct from archive,
  before accepting a permanent-deletion request.
- **FR-053**: System MUST place a deleted memo in pending deletion with a purge deadline 30
  days after the first accepted deletion request. Every API `MoneyMemo` representation MUST carry
  required nullable `purgeDeadline`: canonical non-null UTC for pending deletion and null for
  active or archived.
- **FR-054**: System MUST treat a repeated deletion request for a memo already pending deletion
  as an idempotent success that leaves the purge deadline unchanged. The window MUST NOT be
  extended or reset by repeated requests.
- **FR-055**: System MUST exclude pending-deletion memos from the active list, the archived
  view, every ordinary list, search, filters, and every export.
- **FR-056**: System MUST provide a dedicated Recently Deleted view listing pending-deletion
  memos with their purge deadlines, using the same ordering and paging rules as the active
  list. Text search and filters are not applied in this view.
- **FR-057**: System MUST support, from Recently Deleted, restoring a memo and permanently
  purging it immediately.
- **FR-058**: System MUST let the user restore a pending-deletion memo within the window, back
  to the status it held before deletion was requested, with all values intact.
- **FR-059**: System MUST require a second explicit confirmation before an immediate permanent
  purge.
- **FR-060**: System MUST make a memo unreachable on every path — ordinary lists, Recently
  Deleted, direct read, search, filter, export, and restore — from the instant its purge
  deadline passes, whether or not any scheduled process has run.
- **FR-061**: System MUST operate a scheduled, idempotent physical purge with an operational SLO
  of destroying every expired record within 24 hours of its purge deadline under normal service
  availability. Exact deadline inaccessibility remains governed by FR-060 during any outage.
  Scheduled processing MUST resume automatically after recovery, MUST detect overdue work, MUST
  alert on every 24-hour SLO breach, and MUST retain privacy-safe evidence of scheduler heartbeat,
  outage, breach, recovery run, and overdue-backlog clearance. Physical destruction MUST NOT
  depend solely on a later access attempt.
- **FR-062**: System MUST physically purge an expired memo immediately when any access attempt
  reaches it before the scheduled process does. This fallback supplements FR-061 and MUST NOT
  be relied on as the primary mechanism.
- **FR-063**: System MUST destroy all memo data at purge, making the memo unrecoverable by the
  user and by support.
- **FR-064**: System MUST retain nothing in the live system about a purged memo — no field
  value, creation identifier, creation fingerprint, timestamp, counter, or search-support entry
  — except the purge-ledger entry permitted by FR-065. Retaining anything beyond that REQUIRES
  a documented security, abuse-prevention, or operational purpose and a constitution exception.
- **FR-065**: System MAY retain a purge-ledger entry containing exactly `deletion_token`,
  `purged_at`, and `removal_not_before_at`. `deletion_token` MUST be a keyed, non-reversible token
  that contains no owner, raw memo identifier, or memo metadata. `removal_not_before_at` MUST be
  the earliest cleanup-eligibility time derived from every inventoried backup capable of
  resurrecting the memo; it MUST NOT trigger automatic expiry. The entry's sole purpose is
  preventing a restored backup from reintroducing a purged memo. It MUST contain no financial
  content or owner reference and MUST be removed only after `removal_not_before_at` and verified
  destruction of every backup capable of resurrecting the memo. Failed or unverifiable backup
  destruction MUST retain the entry, raise an alert, retry verification, and block cleanup.
- **FR-066**: System MUST have a documented, bounded backup retention window, stated outside
  this specification, and the purge-ledger lifetime MUST be derived from it.
- **FR-067**: System MUST ensure a purged memo never returns to the live system. Any restore of
  backup data MUST reconcile against the purge ledger before restored data becomes reachable,
  and a restored memo whose purge deadline has already passed MUST be unreachable immediately
  and destroyed by the next scheduled pass.
- **FR-068**: System MUST answer a request naming a purged memo identically to a request naming
  an identifier that was never issued.

#### Categories and Money Spaces

- **FR-069**: System MUST let a user create, rename, deactivate, and reactivate their own
  categories and Money Spaces.
- **FR-070**: System MUST define a Money Space as an organizational label only. The system MUST
  NOT request, encourage, infer, or provide dedicated fields for a bank name, account number,
  routing detail, card detail, credential, token, or statement. User-authored free text is governed
  by FR-010 and FR-098; a Money Space MUST NOT gain banking attributes from entered text.
- **FR-071**: System MUST enforce name uniqueness per user, per kind, compared without regard
  to case, across both active and deactivated items. A collision with a deactivated item MUST
  offer reactivation rather than silently creating a second one.
- **FR-072**: System MUST refuse permanent deletion of a category or Money Space referenced by
  any memo — counting active, archived, and pending-deletion memos — state that memos reference
  it, and offer deactivation instead.
- **FR-073**: System MUST keep deactivated categories and Money Spaces displayed on the memos
  that reference them and available as filter values, while removing them from pickers for new
  memos and for edits.
- **FR-074**: System MUST allow a memo referencing a deactivated category or Money Space to be
  edited in its other fields, keeping that reference. A user MUST NOT be able to newly select a
  deactivated item.
- **FR-075**: System MUST permit permanent deletion of a category or Money Space only when zero
  memos reference it, behind an explicit confirmation, and MUST treat it as irreversible.
- **FR-076**: System MUST apply a rename everywhere the label is displayed without detaching or
  duplicating memos.

#### Search and filtering

- **FR-077**: System MUST match search terms against note text only. Category and Money Space
  are filter dimensions and MUST NOT be free-text search targets.
- **FR-078**: System MUST match case-insensitively and diacritic-insensitively, on trimmed
  input, as a substring match. Multiple terms combine as AND against the note.
- **FR-079**: System MUST reject search terms shorter than 2 characters after trimming, stating
  the minimum, and MUST treat a whitespace-only term as no term rather than as a
  match-everything query.
- **FR-080**: System MUST filter by date range, type, currency, category, Money Space, planned
  status, purpose, and lifecycle status.
- **FR-081**: System MUST restrict the lifecycle filter to the values active and archived, and
  MUST reject any other value as invalid, naming the accepted values.
- **FR-082**: System MUST combine multiple filters, and a search term with filters, using AND.
- **FR-083**: System MUST apply the same ordering, result-set-version paging, exactly-once scope,
  and results-changed refresh behavior from FR-030–FR-035 to search and filtered results. An edit
  that changes membership in the current normalized search/filter query MUST invalidate that
  traversal; an unrelated membership-neutral non-sort edit MUST preserve it.
- **FR-084**: System MUST scope every search and filter combination to the requesting owner. No
  combination — including an empty term or an empty filter set — MUST widen scope beyond the
  owner.
- **FR-085**: System MUST never return pending-deletion memos through search or filters. They
  are reachable only through Recently Deleted.
- **FR-086**: System MUST keep any structure supporting search owner-scoped, MUST erase a
  memo's entry from it at purge, and MUST hold that structure to the same content-exposure
  rules as the memo itself.
- **FR-087**: System MUST treat the search term as user content: it MUST NOT appear in logs,
  traces, metrics, analytics events, crash reports, or error messages. A failed search MUST
  report failure without naming the term or any memo content.

#### Export

- **FR-088**: System MUST let a user export their own memos in a machine-readable format with
  a published field-by-field schema.
- **FR-089**: System MUST produce every export from a single point in time, fixed at the
  instant the export request is accepted.
- **FR-090**: System MUST exclude changes made after that instant and MUST NOT include two
  versions of the same memo.
- **FR-091**: System MUST fail the export, rather than deliver a partial or mixed file, when a
  single-instant view cannot be produced.
- **FR-092**: System MUST represent each amount in export without loss: exact decimal value,
  currency code, and minor-unit scale.
- **FR-093**: System MUST represent each occurrence time in export as an exact instant plus the
  captured UTC offset, so the user's intended local date is reconstructible.
- **FR-094**: System MUST include in export each memo's stable identifier, type, category,
  Money Space, note, planned status, purpose, lifecycle status, creation timestamp, and
  last-update timestamp.
- **FR-095**: System MUST exclude from export every internal field: revision number, creation
  identifier, creation fingerprint, owner reference, page-position data, and all deletion and
  purge-ledger metadata.
- **FR-096**: System MUST export active memos by default, MUST include archived memos only when
  the user explicitly selects them, and MUST never include pending-deletion memos.
- **FR-097**: System MUST never truncate an export silently; an export that cannot complete
  MUST be reported as a failure.

#### Privacy, isolation, and independence

- **FR-098**: System MUST NOT request, encourage, infer, or provide dedicated fields for bank
  credentials, bank account or routing numbers, payment-card details, card verification codes,
  banking tokens, bank statements, or government identifiers. Every free-text entry MUST display
  a clear adjacent warning not to enter those data. Best-effort detection MUST follow FR-010 and
  its exact published pattern set; Cashmemo MUST NOT represent that finite detector as complete
  semantic prevention.
- **FR-099**: System MUST keep memo amounts, note text, category names, Money Space names,
  search terms, creation fingerprints, prohibited-content candidates, and every detector match
  derivative out of logs, traces, metrics, analytics events, inference pipelines, and crash
  reports. Diagnostics MUST identify operations by request/run identifiers only and MUST NOT
  identify the sensitive value or matched detector.
- **FR-100**: System MUST keep memo amounts and note text out of user-facing error messages,
  including validation errors, which state the field and the rule without echoing the value. A
  `PRIVACY_INPUT_REJECTED` response MAY include only a published safe Pattern Set v1 detector
  identifier plus field and correction guidance; it MUST NOT include candidate content, matched
  values, normalization output, offsets, substrings, hashes, or any detector derivative.
- **FR-101**: System MUST scope every read and write to the authenticated owner, and MUST NOT
  infer ownership from any client-supplied field.
- **FR-102**: System MUST answer a request for another user's memo indistinguishably from a
  request for a memo that does not exist, revealing nothing about its existence.
- **FR-103**: System MUST operate with no speech-transcription capability, no AI inference
  capability, and no shared cache service available. Scheduled processing is required only for
  the physical purge of FR-061; every user-visible guarantee — including the inaccessibility of
  FR-060 — MUST hold while that process is not running.
- **FR-104**: System MUST fail closed on authentication and authorization failure: deny the
  operation, return no memo data, and never fall back to an unauthenticated or shared scope.

### Key Entities

- **Money Memo**: One recorded movement of money owned by exactly one user. Carries type,
  amount, currency, occurrence instant with captured offset, category, Money Space, optional
  note, planned status, purpose, lifecycle status, revision, creation identifier, creation
  fingerprint, creation timestamp, and last-update timestamp. Confirmed at submission. Ceases
  to exist at purge.
- **Money Space**: A user-owned organizational label such as Personal, Work, Household,
  Freelance, or Project. Holds a name and an active/deactivated state. Explicitly not a bank
  account and holds no banking attributes.
- **Category**: A user-owned classification label for memos. Holds a name and an
  active/deactivated state. Same uniqueness, reference, and deletion rules as Money Space.
- **Creation identifier**: A client-generated value, stable for one compose session, stored on
  the memo it created and unique per user for that memo's life. Names the creation attempt.
- **Creation fingerprint**: An immutable, irreversible derivation of the field values as
  submitted at creation, written once and never recomputed. It is what a retry is compared
  against, so a retry can be recognized after the memo has been edited. It holds no readable
  amount or note and must not permit confirmation of the original values by guessing.
- **Purge-ledger entry**: Exactly `deletion_token`, `purged_at`, and
  `removal_not_before_at`, retained after purge only to stop a restored backup from reintroducing
  the memo. `deletion_token` is keyed and non-reversible and contains no owner or memo metadata.
  `removal_not_before_at` is only the earliest cleanup-eligibility time. The entry is removed only
  after that time and verified destruction of every backup capable of resurrecting the memo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user records a complete Money Memo in under 30 seconds from opening the entry
  screen, measured at the median across a 20-user task test.
- **SC-002**: 95% of users complete their first memo entry successfully on the first attempt
  without abandoning the form.
- **SC-003**: Retrying an interrupted creation produces zero duplicate memos across 1,000
  simulated retry attempts, including retries issued 30 days after the original request.
- **SC-004**: Retries arriving after the memo was edited return the memo's current version in
  100% of cases, with zero conflicts raised and zero edits reverted.
- **SC-005**: An adversary holding every stored creation fingerprint, and running an exhaustive
  search over plausible amounts, currencies, and dates, confirms zero original values.
- **SC-006**: Two sessions editing the same memo produce zero silently lost edits across 1,000
  simulated concurrent-edit runs; every losing write is reported as a conflict and applies no
  field.
- **SC-007**: A user whose save is rejected by a conflict recovers their unsaved input in 100%
  of cases without retyping.
- **SC-008**: Listing the same unchanged journal twice returns identical ordering in 100% of
  runs.
- **SC-009**: Paging through a 10,000-memo journal whose membership and ordering remain unchanged
  returns every memo exactly once, with zero duplicates and zero omissions. In 100% of runs,
  creation, archive, restore, deletion request, purge-deadline crossing, purge, occurrence-time edit, or a current-query
  membership change invalidates the continuation before any page is accepted and visibly requires
  refresh; a non-sort-key edit that preserves current-query membership preserves traversal.
- **SC-010**: Every occurrence-time change that shifts a paging result set produces a
  results-changed signal to the user in 100% of runs; zero shifted sets are presented as
  complete.
- **SC-011**: Cross-user access attempts return zero records belonging to another user across
  the full surface — read, list, Recently Deleted, search, filter, export, and label management
  — in 100% of attempts, across every filter and search combination exercised.
- **SC-012**: An automated scan of all logs, traces, analytics events, crash reports, and
  user-facing error responses produced by a full exercise of this feature finds zero memo
  amounts, zero note text, zero search terms, and zero creation fingerprints.
- **SC-013**: Across the published Pattern Set v1 fixture corpus, 100% of blocking-class matches
  are absent from server persistence, 100% of warning/block outcomes preserve the unsaved local
  input and correction path, and automated capture scans find zero candidate values or match
  derivatives in diagnostics. Evidence reports false positives and fixture-bounded false
  negatives per detector and makes no claim about unenumerated semantic forms.
- **SC-014**: A user finds a specific memo among 2,000 using search or filters in under 15
  seconds at the median.
- **SC-015**: Search and filter results return in under 1 second for journals up to 10,000
  memos, at the 95th percentile.
- **SC-016**: An export of 10,000 memos round-trips every documented field with zero value
  changes, including amounts in zero-, two-, and three-minor-digit currencies, and contains
  zero internal fields.
- **SC-017**: An export taken while 100 memos per second are being modified reflects exactly
  one instant, with zero memos appearing in two versions, across 100 runs.
- **SC-018**: Restoring a memo from archive or from Recently Deleted returns 100% of its field
  values unchanged.
- **SC-019**: A memo whose purge deadline has passed is unreachable on 100% of access paths
  within the same instant, measured with the scheduled process disabled entirely.
- **SC-020**: 100% of expired memos whose full deadline-to-deletion interval has normal service
  availability are physically destroyed within 24 hours, measured over a 30-day controlled-clock
  run with no access attempts touching them. Outage cases prove immediate logical inaccessibility,
  heartbeat and SLO-breach alerts, automatic idempotent recovery, overdue detection, and complete
  backlog clearance after availability returns.
- **SC-021**: After a purge, an exhaustive sweep of the live system finds zero references to
  the memo apart from its exact three-field purge-ledger entry. Time passage alone removes zero
  tokens. After `removal_not_before_at` and verified destruction of every capable backup, the
  sweep finds zero references at all; failed verification retains the token and blocks cleanup.
- **SC-022**: Restoring a backup taken before a deletion reintroduces zero purged memos into
  the live system, across 100 restore drills.
- **SC-023**: A purged memo is unreachable through every available path — read, list, Recently
  Deleted, search, filter, export, and restore — in 100% of attempts.
- **SC-024**: Permanent deletion of a category or Money Space is refused in 100% of cases where
  at least one active, archived, or pending-deletion memo references it, and zero memos lose
  their label as a result of any label operation.
- **SC-025**: The full feature passes its acceptance suite in an environment with no speech
  transcription capability, no AI inference capability, and no shared cache service available.

## Assumptions

Decisions taken where the description left room, recorded so they can be challenged:

- **Amount sign**: amounts are always positive; direction is carried by type. Rejecting signed
  amounts avoids two contradictory representations of the same expense.
- **Amount precision and bound**: precision follows the currency's minor unit; maximum is
  999,999,999,999 major units. Chosen to fit real personal finance while blocking typos.
- **Currency after creation**: editable, never converted, gated by an unsuppressible
  confirmation on every change. Currency conversion is out of scope, so re-declaring is the
  only honest option; making currency immutable would strand memos entered with a wrong default.
- **Time zone model**: instant plus captured offset, with the offset immune to edits of the
  time and changeable only by an explicit zone change. Storing only UTC would shift a user's
  "July 31" after travel; storing only local wall time would break ordering; re-capturing the
  offset on edit would let travel silently move past memos across date boundaries.
- **Date filtering**: each memo's own local date decides inclusion. The consequence — two
  same-instant memos with different offsets landing on different filter dates — is accepted
  deliberately, because the filter answers a question about the user's lived days.
- **Note limit**: 1,000 characters — generous for a journal note, small enough to bound
  storage and search cost.
- **Duplicate protection**: a durable creation identifier plus an immutable creation
  fingerprint. Comparing a retry against the fingerprint rather than the live memo is what lets
  a delayed retry succeed after the user has edited the memo; comparing against live values
  would turn ordinary corrections into spurious conflicts.
- **Fingerprint secrecy**: because amounts, currencies, and dates occupy a small value space, a
  fingerprint an observer can recompute is equivalent to storing the values. FR-023 therefore
  demands resistance to confirmation by exhaustive guessing, which constrains how the
  fingerprint is derived at plan time.
- **Pagination**: position-based within the total order, default 50, maximum 200. The
  no-duplicate no-skip guarantee is scoped to everything except sort-key edits, which are
  surfaced instead of hidden. A full paging snapshot was rejected as costly and stale; ordering
  by creation time was rejected because the journal must read chronologically by when money
  moved.
- **Search scope**: note text only, minimum 2 characters. Category and Money Space are reached
  through filters, which keeps search a text tool and keeps label names out of the free-text
  matching path.
- **Deletion model**: 30-day Recently Deleted window with restore and immediate purge. Repeated
  deletion requests never extend the window, so a retry loop cannot keep a memo alive.
- **Purge mechanism**: inaccessibility is immediate and scheduler-independent; physical
  destruction is the scheduled process's job with a 24-hour operational SLO under normal service
  availability. Outages do not pause logical expiry; scheduled work resumes idempotently after
  recovery, overdue records and SLO breaches alert operators, and access-time purge remains a
  fallback only. Making destruction depend on access would leave untouched records alive
  indefinitely.
- **Free-text privacy boundary**: Cashmemo never asks for or models prohibited banking data. A
  clear warning appears beside free-text entry, and the published Pattern Set v1 applies
  best-effort deterministic checks. That finite detector can report only behavior against its
  declared patterns; arbitrary language can still cause false positives and false negatives.
- **Post-purge retention**: nothing in the live system except a bounded purge-ledger entry. The
  ledger exists solely because "purged records must never return" cannot be enforced against a
  backup taken before the deletion request without knowing what was purged. It carries no
  financial content and is removed only after its eligibility time plus verified destruction of
  every backup that could resurrect the memo.
- **Backup retention window**: bounded and documented outside this specification. This spec
  requires the window to exist and derives the purge-ledger lifetime from it, but does not set
  its value.
- **Creation identifier release at purge**: accepted as safe. Purge requires explicit user
  action plus a 30-day wait or a second destructive confirmation; no client retry horizon
  approaches that.
- **Category / Money Space deletion**: deactivate when referenced, permanently delete only when
  unreferenced. Preserves the historical meaning of existing memos. Names are unique per user
  per kind across active and deactivated items so reactivation can never collide.
- **Stale writes**: revision-checked, whole-submission rejection, no server-side merge. The
  user, not the system, resolves which value is correct.
- **Export format**: a documented structured text format with a published schema; a
  point-in-time snapshot; archived excluded by default; internal fields excluded entirely.
  Format choice is a user-facing contract; the concrete serialization is settled during
  planning.
- **Export delivery**: synchronous for the journal sizes targeted here; asynchronous delivery
  is deferred until a size threshold demands it.
- **Categories and Money Spaces**: user-owned and user-managed, not global. A starter set is
  seeded for new users so memo creation works before any label management happens; the user may
  rename or deactivate any of it.
- **Authentication**: an authenticated user identity already exists and is available to this
  feature; building sign-in is out of scope.
- **Single-user ownership**: every memo, category, and Money Space belongs to exactly one user.
  Sharing and multi-user spaces are out of scope.

## Out of Scope

Named explicitly so planning does not drift into them:

- Voice recording, audio handling, and speech transcription
- AI extraction, categorization, suggestions, and any background inference work
- Bank connections, bank synchronization, and imported statements
- Recurring or scheduled memos
- Budgets, insights, reports, and analytics dashboards
- Currency conversion and multi-currency totals
- Attachments and receipt images
- Sharing, collaboration, and multi-user Money Spaces
- Sign-in, sign-up, and account management
- The backup retention policy itself, which is documented separately (FR-066)
