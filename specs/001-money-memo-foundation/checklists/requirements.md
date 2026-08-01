# Specification Quality Checklist: Private Money Memo Foundation

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-31
**Last revalidated**: 2026-08-01 (after free-text privacy and physical-purge SLO reconciliation)
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Constitution Alignment

Checked against `.specify/memory/constitution.md` v1.0.0:

- [x] **I. Privacy by Default** — FR-098 (no solicitation, inference, or dedicated prohibited-data
      fields; adjacent warning; no complete-semantic-detection claim), FR-010 and Pattern Set v1
      (documented best-effort boundary behavior, draft preservation, correction path), FR-099
      (candidate values and match derivatives excluded from diagnostics), FR-100 (no value echo),
      FR-023, SC-005, SC-012, SC-013; literal universal free-text conflict is governed by C-07
- [x] **II. User-Confirmed Truth** — FR-029 (manual submission is the confirmation; no
      server-side unconfirmed draft persists in this feature)
- [x] **III. Temporary Audio** — not applicable; audio is out of scope
- [x] **IV. Graceful Degradation** — FR-103 (no speech, AI, or shared cache capability
      required; user-visible guarantees hold while the scheduled purge process is down),
      FR-060 + SC-019
- [x] **V. Data Ownership** — US7 export (FR-088 to FR-097), US5 permanent deletion,
      FR-060 to FR-068 (immediate inaccessibility, 24-hour physical-destruction SLO under normal
      availability, automatic outage recovery, breach alerts/evidence, no backup resurrection,
      bounded ledger), SC-019 to SC-023
- [x] **VI. Architecture Discipline** — deferred to `/speckit-plan` by design. This principle
      governs structure (modular monolith, domain isolation, provider interfaces, Appwrite
      accessed only through supported APIs), none of which a specification may decide. The spec
      discharges its part by naming zero technologies.
- [x] **VII. Reliability** — FR-020 to FR-028 (durable duplicate protection with no expiry
      cliff; retries survive edits), FR-040 to FR-046 (stale writes rejected whole, never
      partially applied), FR-042 (drafts preserved), FR-005 / FR-008 / FR-034 / FR-097 (no
      silent rounding, truncation, clamping, or partial export), FR-032–FR-033 (result-set version
      guards exactly-once traversal and changed sets require refresh), FR-081 (invalid filter value
      rejected, not silently empty)
- [x] **VIII. Security** — FR-101 (owner-scoped, never inferred from client input), FR-102
      (existence not disclosed), FR-104 (fail closed), FR-084 (no search or filter combination
      widens scope), FR-023 (fingerprint is not a disclosure channel), FR-009
- [x] **IX. Quality Gates** — eight independently testable user stories, each with an
      Independent Test statement and acceptance scenarios; privacy and deletion assertions
      stated as testable criteria (SC-005, SC-012, SC-013, SC-021, SC-022)
- [x] **X. Scope Discipline** — Out of Scope names every excluded category, including all
      constitutionally prohibited ones and the separately-documented backup retention policy

**Final status**: PASS WITH EXCEPTION C-07 — 26/26 checked. Ready for task generation with C-07
kept visible in tasks, reviews, release evidence, and annual/material-change governance review.

## Correction Coverage — this revision

| # | Directed correction | Where it landed |
|---|---------------------|-----------------|
| 1 | Immutable creation fingerprint per memo | FR-002, FR-022 |
| 1 | Compare retries against original content, not the live memo | FR-026, US1 scenario 7 |
| 1 | Matching retry returns the memo's *current* version after edits | FR-024, US1 scenarios 7 and 11, SC-004 |
| 1 | Same identifier, different original content → conflict | FR-025, US1 scenario 8 |
| 1 | Fingerprint carries no plaintext amount or note | FR-023, US1 scenario 9, SC-005 |
| 2 | Immediately inaccessible at the deadline | FR-060, US5 scenario 8, SC-019 |
| 2 | Physical destruction not dependent solely on access | FR-061, FR-062, US5 scenarios 9, 16 |
| 2 | 24-hour operational SLO under normal availability | FR-061, US5 scenario 9, SC-020 |
| 2 | Automatic idempotent outage recovery and overdue/SLO alerts | FR-061, US5 scenario 16, SC-020 |
| 2 | Access after deadline triggers purge as fallback | FR-062, US5 scenario 10 |
| 2 | Backup retention documented separately | FR-066, Out of Scope |
| 2 | Purged records never return to the live system | FR-067, US5 scenarios 12 and 13, SC-022 |
| 3 | Lifecycle filters restricted to active and archived | FR-081, US6 scenario 10 |
| 3 | Dedicated Recently Deleted view | FR-056, US5 scenario 3 |
| 3 | Recently Deleted supports restore and immediate purge | FR-057, FR-059, US5 scenarios 4 and 5 |
| 3 | Excluded from ordinary lists, search, export | FR-036, FR-055, FR-085, FR-096 |
| 4 | No banking-data solicitation, inference, or dedicated fields | FR-070, FR-098 |
| 4 | Adjacent warning and exact Pattern Set v1 | FR-010, FR-098, US1 scenarios 13–15 |
| 4 | Warn/block preserves draft and correction path without diagnostic disclosure | FR-010, FR-099, US1 scenarios 14–15, SC-013 |
| 4 | No complete-semantic-detection claim; errors documented honestly | FR-010, FR-098, SC-013, Assumptions |

## Contradictions

**No unresolved specification contradictions.** One explicit constitution conflict remains governed
by C-07: finite detection cannot satisfy Principle I's literal universal rejection rule for arbitrary
free text. It is documented, owned, reviewable, and removable; it is not silently reinterpreted.

Pagination tension is resolved: FR-032/SC-009 promise complete exactly-once traversal only while
membership/order remain unchanged. Page, request, and protected cursor bind one result-set version;
enumerated membership/order mutations require refresh, membership-neutral non-sort edits preserve
traversal, and purge/expiry inaccessibility always wins.

Earlier backup/deletion tension remains resolved: correction 2 requires that purged records never
return after backup restore, which requires bounded suppression state outside a restored backup.

Resolved by scoping the remnant as narrowly as the requirement allows:

- FR-065 permits exactly `deletion_token`, `purged_at`, and `removal_not_before_at`.
  `deletion_token` is keyed/non-reversible and contains no owner/raw memo ID/memo metadata;
  no financial content is retained.
- FR-064 keeps the general prohibition and names FR-065 as the sole exception, holding any
  further retention to the constitution's documented-purpose bar.
- `removal_not_before_at` is earliest cleanup eligibility, not TTL. Entry is removed only after
  that time and verified destruction of every backup capable of resurrection; failed verification
  retains token, alerts, retries, and blocks cleanup (FR-065, FR-066).
- SC-021 tests both halves: nothing but the exact three-field ledger entry after purge, time alone
  removes nothing, and nothing remains after eligibility plus verified destruction closure.

The alternative — accepting that a restore silently rolls a user's deletions back — was
rejected as a worse privacy outcome than a content-free identifier.

**Two resolved from the previous revision**: the retry-after-edit conflict (now FR-024/FR-026,
returns the current version) and the lifecycle filter value that always returned empty (now
FR-081, rejected as invalid).

**Resolved earlier this session**: FR-103 no longer forbids all scheduled processing, which had
contradicted the 30-day purge. It now permits exactly the FR-061 purge process and requires
every user-visible guarantee to hold while that process is down (SC-019 measures this with the
scheduler disabled).

**Two resolved by 2026-08-01 specification correction**:

- Absolute semantic prevention in arbitrary free text was replaced by no solicitation/inference/
  dedicated banking fields, adjacent warning, exact finite Pattern Set v1, preserved unsaved input,
  correction path, diagnostic isolation, and explicit false-positive/false-negative limits.
- Unconditional 24-hour physical destruction was replaced by 24-hour operational SLO under normal
  availability while exact deadline inaccessibility remains unconditional. Automatic idempotent
  recovery, overdue detection, breach alerting, and operational evidence are now mandatory.

Physical-purge correction needs no constitution exception. Free-text correction requires C-07 until
constitution amendment or removal of arbitrary free text. It does not allow dedicated prohibited-
data design, solicitation, inference, sensitive diagnostics, or knowingly accepted blocking-class
matches.

## Uncovered Requirements

None. FR-066 is covered by `docs/operations/backup-retention.md`, which defines 30-day maximum
retention, ownership, evidence, `removal_not_before_at` derivation, and verified-destruction cleanup
gate. Every functional requirement traces to acceptance, success, test, or operational evidence.

## Remaining Verification Gaps

Nothing here blocks task generation.

**Not verifiable by an automated suite** — needs a documented manual procedure:

1. **SC-001, SC-002, SC-014** require a human task test (20-user panel, median timings,
   first-attempt completion rate). Planning must define the protocol and where evidence lives.
2. **SC-022** (backup restore drills) exercises operational tooling rather than product code.
   Planning must say who runs the drill and how often.

**Planning-dependent verification now resolved:**

3. **FR-023 / SC-005** use wrapped per-memo HMAC keys and construction/threat-model tests in
   `research.md` R-04 and `test-strategy.md`.
4. **SC-021** sweep surfaces are enumerated in `data-model.md` and exercised by real restore and
   purge suites.
5. **FR-086** search support is defined in `research.md` R-08 and purged transactionally with memo.
6. **FR-088** serialization is published in `contracts/export-v1.schema.json`.
7. **SC-015** has pinned real-Appwrite performance gate in `test-strategy.md`.

**Deliberate consequences worth an explicit confirm before building:**

8. **FR-033 over-signalling is not forbidden**: the spec requires a results-changed signal when
   a sort-key edit shifts the set, but does not prohibit signalling on any journal change.
   Correct and noisy. Planning should decide whether a coarse change marker is acceptable.
9. **FR-056 Recently Deleted has no search or filters**: a user with many deleted memos can
    only page to find one to restore. Accepted simplification; revisit if the 30-day window
    fills in practice.
10. **FR-024 returns archived and pending-deletion memos to a retry** with their status
    reported rather than resurrecting them. Correct; a retrying client can learn a memo was
    deleted, but that is the same user's own data, so it is not a disclosure issue.
