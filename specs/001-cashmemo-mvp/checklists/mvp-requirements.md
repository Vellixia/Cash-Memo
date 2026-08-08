# MVP Requirements Quality Checklist: Cashmemo MVP

**Purpose**: Formal release-gate review of product, privacy, lifecycle, resilience, and production
requirements before implementation planning  
**Created**: 2026-08-09  
**Feature**: [spec.md](../spec.md)  
**Audience/Timing**: Product, privacy/security, engineering, and QA reviewers before planning

**Note**: Questions evaluate requirements writing, not implementation behavior.

## Product and Journey Completeness

- [x] CHK001 Are account creation, verification, login, logout, reset, session restoration, expiry,
  and reauthentication requirements all defined? [Completeness, Spec §FR-001–FR-005]
- [x] CHK002 Does onboarding specify the privacy model, user preferences, assisted-provider notice,
  and usable empty state? [Completeness, Spec §FR-006–FR-011]
- [x] CHK003 Are manual, natural-language, and voice capture separate observable journeys with one
  shared confirmed Money Memo outcome? [Consistency, Spec §User Stories 2–3]
- [x] CHK004 Is every requested memo lifecycle action—create, view, list, edit, archive, restore,
  Recently Deleted, and permanent deletion—specified? [Completeness, Spec §FR-035–FR-045]
- [x] CHK005 Are Home, organization/search, monthly review, export/account deletion, and degraded
  operation represented as independently valuable stories? [Coverage, Spec §User Stories 4–8]
- [x] CHK006 Is Feature 001 completion distinguished from unit-test or mock-only completion?
  [Clarity, Spec §Explicit MVP Completion Definition]

## Domain and Calculation Clarity

- [x] CHK007 Are all Money Memo fields, ownership, lifecycle, and revision semantics defined without
  modeling a bank account? [Clarity, Spec §FR-012–FR-023; §Key Entities]
- [x] CHK008 Are amount sign, scale, size, locale parsing, and ambiguous-input rules objectively
  testable? [Clarity, Spec §FR-014–FR-016]
- [x] CHK009 Are occurrence instant, timezone, future-time, editing, and period-membership semantics
  mutually consistent? [Consistency, Spec §FR-017–FR-019; §Calculation Rules]
- [x] CHK010 Are multi-currency totals explicitly separated with conversion and consolidated
  valuation excluded? [Scope, Spec §FR-016; FR-078]
- [x] CHK011 Are inclusion/exclusion rules for active, archived, draft, Recently Deleted, and purged
  memos defined for every calculation? [Completeness, Spec §FR-037–FR-041; FR-077]
- [x] CHK012 Are net movement, category, planned/unplanned, purpose, top-category, comparison, tie,
  rounding, zero-denominator, and incomplete-month rules reproducible? [Measurability, Spec
  §FR-074–FR-087; §Calculation Rules]

## User-Confirmed Truth and Draft Recovery

- [x] CHK013 Is draft state structurally and behaviorally distinct from confirmed truth across
  manual and assisted paths? [Consistency, Spec §FR-024–FR-026]
- [x] CHK014 Are every extracted field's editability, ambiguity state, and mandatory confirmation
  requirements explicit? [Clarity, Spec §FR-026; FR-048–FR-051]
- [x] CHK015 Are draft autosave, local-only recovery, synchronization labeling, expiry, cancellation,
  and failure preservation rules specified? [Recovery, Spec §FR-027–FR-030]
- [x] CHK016 Are retry identity, deduplication window, revision conflict, and unsaved-value recovery
  requirements quantified? [Reliability, Spec §FR-031–FR-034]
- [x] CHK017 Does the spec prohibit delayed provider output from altering confirmed data?
  [Security/Consistency, Spec §FR-061]

## Voice, AI, and Provider Boundaries

- [x] CHK018 Are voice consent, recording states, maximum duration, retry, cancellation, and manual
  alternatives defined? [Completeness, Spec §FR-052–FR-059]
- [x] CHK019 Is raw-audio deletion specified for success, cancellation, unrecoverable failure,
  account deletion, abandoned flow, and expiry? [Lifecycle Coverage, Spec §FR-054–FR-056]
- [x] CHK020 Are transcript, original text, and extraction-output retention/deletion rules explicit
  through confirmation, cancellation, expiry, and account deletion? [Lifecycle Coverage, Spec
  §FR-047; FR-057; FR-060]
- [x] CHK021 Are AI ambiguity, malformed output, prompt injection, relative-date, and partial-failure
  requirements defined without trusting provider output? [Edge Cases, Spec §FR-048–FR-051]
- [x] CHK022 Are provider disclosure, no-training/retention controls, material-change disabling, and
  replaceability stated as release constraints? [Dependency, Spec §FR-007; FR-096–FR-098]

## Privacy, Security, and C-07 Honesty

- [x] CHK023 Are prohibited dedicated fields/connections enumerated consistently with product scope?
  [Consistency, Spec §FR-088; §Explicitly Out of Scope]
- [x] CHK024 Does the spec distinguish hard guarantees, best-effort controls, operational service
  levels, and known limitations? [Clarity, Spec §Privacy Claim Classification]
- [x] CHK025 Is the arbitrary-language false-negative conflict explicit instead of claiming complete
  semantic detection? [Conflict, Spec §Constitution Alignment and C-07 Disposition; FR-091]
- [x] CHK026 Is voice's unavoidable pre-transcription provider exposure stated and controlled by
  warning, provider review, and post-transcription detection? [Known Limitation, Spec §FR-092]
- [x] CHK027 Are telemetry exclusions broad enough to cover financial fields, labels, search,
  providers, export, diagnostics, crash reports, and evidence? [Completeness, Spec §FR-093–FR-094]
- [x] CHK028 Are cross-user isolation and fail-closed non-owner behavior defined for every protected
  operation? [Security Coverage, Spec §FR-002; FR-045]
- [x] CHK029 Does the spec define a privacy-safe incident path for prohibited data later found in
  arbitrary input? [Exception Flow, Spec §FR-106]
- [x] CHK030 Is C-07 explicitly scoped anew, with historical acceptance/task references rejected and
  governance reconciliation required before planning approval? [Governance, Spec §Constitution
  Alignment and C-07 Disposition]

## Organization, Search, and State Coverage

- [x] CHK031 Are categories and Money Spaces owner-scoped, lifecycle-aware, reference-safe, and
  explicitly non-banking concepts? [Completeness, Spec §FR-063–FR-067]
- [x] CHK032 Are every required filter, within-filter/across-filter semantics, search field, ordering,
  pagination stability, and transient-query rule specified? [Clarity, Spec §FR-036; FR-068–FR-073]
- [x] CHK033 Are loading, empty, no-result, stale, partial, conflict, unauthorized, rate-limit, and
  unrecoverable states required across critical journeys? [Scenario Coverage, Spec §FR-011;
  FR-072; FR-121]
- [x] CHK034 Are concurrent category/Money Space changes, lifecycle expiry races, late search
  responses, and pending work during account deletion addressed? [Edge Cases, Spec §Edge Cases and
  Failure Handling]

## Data Ownership and Deletion Lifecycle

- [x] CHK035 Are export scope, exclusions, formats, exact values, schema version, point-in-time
  consistency, and whole-package failure defined? [Completeness, Spec §FR-099–FR-101]
- [x] CHK036 Are memo and account deletion authentication, confirmation, immediate inaccessibility,
  live cleanup, provider cancellation, and backup cleanup defined? [Lifecycle Coverage, Spec
  §FR-042–FR-044; FR-102–FR-105]
- [x] CHK037 Are retention periods and deletion triggers stated for every user-content data class?
  [Completeness, Spec §Data Lifecycle]
- [x] CHK038 Does restore behavior explicitly prevent resurrection of accepted deletions?
  [Recovery/Security, Spec §FR-104–FR-105; FR-116]
- [x] CHK039 Are physical-deletion and backup promises expressed as bounded service levels with
  outage limitations rather than impossible absolutes? [Measurability, Spec §FR-103–FR-107]

## Production and Evidence Readiness

- [x] CHK040 Does production completion require real identity, persistence, speech-to-text, AI,
  export, deletion, and public product journeys? [Completeness, Spec §FR-108]
- [x] CHK041 Are installability, mobile/browser support, accessibility, and non-voice alternatives
  measurable? [Non-Functional Coverage, Spec §FR-109–FR-111]
- [x] CHK042 Are availability, performance, capacity, audio cleanup, deletion, RPO, and RTO targets
  quantified? [Measurability, Spec §FR-112–FR-116; SC-009–SC-017]
- [x] CHK043 Are privacy-safe observability signals and release-blocking alert classes specified?
  [Operational Coverage, Spec §FR-113–FR-114]
- [x] CHK044 Are deployment, rollback, secrets, provider fallback, backup, restore, cleanup, deletion,
  and incident runbooks required? [Completeness, Spec §FR-117; FR-120]
- [x] CHK045 Is real-service acceptance evidence required where mocks cannot prove behavior?
  [Evidence Quality, Spec §FR-118–FR-119; SC-020–SC-021]

## Scope, Assumptions, and Contradictions

- [x] CHK046 Is the out-of-scope list explicit enough to block bank sync, payments, advanced finance,
  native/shared/offline expansion, and microservices? [Scope, Spec §Explicitly Out of Scope]
- [x] CHK047 Are authentication, language, currency, network, provider, service-level, and AI-narrative
  assumptions visible for formal clarification? [Assumption, Spec §Assumptions and Dependencies]
- [x] CHK048 Are rejected alternatives documented where convenient defaults would violate product
  principles or create impossible claims? [Tradeoff, Spec §Rejected Product Alternatives]

## Notes

- Result: 48/48 requirements-quality items pass on initial formal review.
- Checklist depth: formal pre-planning/release gate; focus includes product completeness, privacy,
  data lifecycle, failure recovery, calculation determinism, and real-service production evidence.
- Passing means required behavior is stated clearly enough to review and test. It does not claim any
  implementation exists.
