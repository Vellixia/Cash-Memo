<!--
Sync Impact Report
==================
Version change: TEMPLATE (unversioned placeholders) → 1.0.0
Bump rationale: Initial ratification. First concrete constitution replacing the
unfilled template; no prior version to compare for backward compatibility.

Modified principles:
  [PRINCIPLE_1_NAME] → I. Privacy by Default
  [PRINCIPLE_2_NAME] → II. User-Confirmed Truth
  [PRINCIPLE_3_NAME] → III. Temporary Audio
  [PRINCIPLE_4_NAME] → IV. Graceful Degradation
  [PRINCIPLE_5_NAME] → V. Data Ownership

Added sections:
  - Principle VI. Architecture Discipline (expanded beyond template's 5 slots)
  - Principle VII. Reliability
  - Principle VIII. Security
  - Principle IX. Quality Gates
  - Principle X. Scope Discipline
  - Product Constraints (filled [SECTION_2_NAME])
  - Development Workflow & Evidence (filled [SECTION_3_NAME])

Removed sections: none

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — "Constitution Check" defers to this file
     dynamically ("[Gates determined based on constitution file]"); Complexity Tracking
     table already carries violation justification. No edit required.
  ✅ .specify/templates/spec-template.md — no constitution-specific slots; independently
     testable user stories (Principle IX) already the template's organizing unit.
  ✅ .specify/templates/tasks-template.md — task categorization by user story already
     satisfies Principle IX; principle-driven task types (privacy tests, deletion tests,
     idempotency) are per-feature, not template-level.
  ✅ .specify/templates/checklist-template.md — no changes required.
  ✅ .claude/skills/speckit-*/SKILL.md — all reference `.specify/memory/constitution.md`
     generically; no outdated or agent-specific naming found.
  ✅ Runtime guidance docs — repository has no README.md or docs/ yet; when added, they
     MUST reference this constitution.

Follow-up TODOs: none. All placeholders resolved.
-->

# Cashmemo Constitution

## Core Principles

### I. Privacy by Default

- The system MUST NOT request, accept, transmit, or store bank credentials, bank account
  numbers, payment card numbers, CVV/CVC codes, bank statements, banking access tokens, or
  government identification numbers. Any input path that could receive such a value MUST
  reject it at the trust boundary rather than storing and later scrubbing it.
- Data collection MUST be limited to what Money Memo functionality requires. Adding a new
  persisted field REQUIRES an explicit specification entry stating why the feature cannot
  work without it.
- Sensitive financial content — amounts, notes, transcripts, counterparties, category
  detail — MUST NOT appear in logs, traces, metrics, analytics events, crash reports, or
  error messages returned to any client. Diagnostics MUST reference records by opaque
  identifier only.

Rationale: Cashmemo's reason to exist is that recording money does not require handing over
banking access. A single leaked log line breaks that promise permanently and cannot be
retracted.

### II. User-Confirmed Truth

- Output from AI extraction and from speech-to-text MUST be presented as an editable draft.
  Every AI-populated field MUST be user-editable before confirmation.
- No AI-generated or STT-generated Money Memo MAY be persisted as a confirmed record before
  an explicit user confirmation action. Drafts MUST be stored distinctly from confirmed
  records and MUST be distinguishable in the data model, not by convention.
- Confirmed user data is authoritative. AI output MUST NOT overwrite, re-classify,
  re-categorize, or silently enrich a confirmed Money Memo.

Rationale: A money journal is only useful if the user trusts every row. One silently wrong
AI-written record destroys trust in the whole ledger, so the model never gets the last word.

### III. Temporary Audio

- Raw audio is transient processing input, never user content.
- Audio MUST be deleted after any of: successful transcription, user cancellation, retention
  expiry, or unrecoverable failure. Every one of these four paths MUST have an automated test
  proving deletion occurred.
- Deletion MUST be enforced by the component that owns the audio lifecycle, not left to
  caller discipline. A maximum retention window MUST be specified and enforced by a sweeper
  so that an abandoned or crashed flow still expires its audio.
- Permanent or long-term voice storage is FORBIDDEN unless a future feature specification
  explicitly introduces it with its own consent, retention, and deletion rules.

Rationale: Voice recordings are far more sensitive than the text derived from them. Keeping
audio only as long as transcription needs it removes an entire class of breach impact.

### IV. Graceful Degradation

- Manual text entry MUST support create, read, update, and delete of Money Memos while STT,
  AI, Redis, or any external provider is unavailable. This path MUST NOT hold a hard
  dependency on any of them.
- Provider failure MUST NOT corrupt, delete, or alter confirmed Money Memos.
- Degraded operation MUST be surfaced to the user explicitly, naming the unavailable
  capability. Degradation MUST NOT be presented as normal operation.

Rationale: The journal is the product; voice and AI are accelerators. An outage in an
accelerator must never cost a user the ability to record money.

### V. Data Ownership

- Users MUST be able to export their data in a machine-readable format and to permanently
  delete their account data.
- Deletion, retention, archive, and recovery behavior MUST be explicitly specified per data
  class — confirmed memos, drafts, audio, transcripts, derived AI metadata — and each
  specified behavior MUST be covered by tests.
- User data MUST NOT be used for model training. Provider integrations MUST be configured to
  disable training and provider-side retention where such controls exist; absence of those
  controls is a blocking factor in provider selection and MUST be recorded in the
  provider decision.

Rationale: Data the user cannot take out or destroy is not the user's data. Export and
deletion are what make the privacy claim verifiable rather than promised.

### VI. Architecture Discipline

- The system starts as, and remains, a modular monolith. Splitting into separately deployed
  services REQUIRES a documented exception per the Governance section.
- Domain logic MUST NOT import HTTP handlers, persistence adapters, AI/STT provider SDKs, or
  web framework types. Dependencies point inward toward the domain.
- Appwrite MUST be accessed only through its supported APIs and SDKs. Reading from or writing
  to Appwrite's internal MongoDB is FORBIDDEN.
- Every external provider — STT, AI, cache, storage, notification — MUST sit behind a
  project-owned interface narrow enough that a replacement provider can be introduced without
  changing domain code.

Rationale: Voice and AI providers change fast and Appwrite internals are not a contract.
Isolation keeps those changes to adapter-sized work instead of rewrites.

### VII. Reliability

- Any write reachable by a retry — client retry, queue redelivery, background job — MUST be
  idempotent, keyed by a caller-supplied idempotency key or a deterministic natural key.
- A failed network operation MUST preserve the user's recoverable draft so the entry can be
  resumed rather than re-dictated or re-typed.
- Concurrent update and stale write behavior MUST be explicitly specified per mutable entity
  (last-write-wins, version conflict rejection, or merge) and enforced by a version or
  revision check, not left to database default behavior.
- Silent data loss, silent truncation, and silent fallback are FORBIDDEN. Any truncation,
  fallback to a degraded provider, or partial success MUST be reported to the caller and
  made visible to the user.

Rationale: Money entries are entered once, in the moment. A lost or silently altered entry
is not recoverable from the user's memory a week later.

### VIII. Security

- All external input MUST be validated at the trust boundary against an explicit schema
  before reaching domain logic.
- Every protected operation MUST enforce user isolation by checking resource ownership
  against the authenticated principal. Ownership MUST NOT be inferred from a client-supplied
  field.
- Secrets MUST come from runtime configuration. Committing a secret is forbidden and MUST be
  blocked by an automated scanning gate.
- Authentication and authorization failures MUST fail closed: deny the operation, return no
  resource data, and never degrade into an unauthenticated or shared-scope path.

Rationale: Financial journals are per-user by nature; a single missing ownership check is a
full cross-user disclosure.

### IX. Quality Gates

- Every feature MUST define independently testable user stories whose acceptance criteria can
  be verified without implementing the other stories.
- The required gate set is: formatting, linting, type checking, unit tests, integration
  tests, privacy tests, and acceptance evidence. All gates MUST pass before a feature is
  considered complete.
- Privacy tests MUST at minimum assert that prohibited data classes (Principle I) are
  rejected at the boundary and that sensitive content is absent from log, trace, and error
  output.
- Mock-only evidence is insufficient where a requirement expects real integration behavior.
  Such requirements MUST be evidenced against the real dependency or against a fake verified
  by a contract test run against the real dependency.
- A task is complete only when implementation AND verification evidence both exist. "Code
  written" is not "done".

Rationale: Privacy and data-integrity guarantees are unfalsifiable without tests that try to
break them, so the gate set is part of the guarantee, not overhead on it.

### X. Scope Discipline

- Bank synchronization, payment processing, double-entry accounting, investment tracking, tax
  filing, and autonomous financial advice are OUT OF SCOPE. None MAY be introduced without a
  separate specification and an approved exception.
- Speculative infrastructure and premature microservices MUST NOT be added. Infrastructure is
  justified by a current, specified requirement.

Rationale: Every excluded category would drag in regulated data or bank connectivity — the
exact things Principle I exists to keep out.

## Product Constraints

Cashmemo is a privacy-first, voice-first money journal. Users manually record income and
expenses using text or voice. Cashmemo does not connect to bank accounts.

**Definitions**

- **Money Memo**: a single income or expense record owned by exactly one user.
- **Draft**: an unconfirmed candidate Money Memo, whether typed, transcribed, or
  AI-extracted. Drafts are not part of the user's ledger.
- **Confirmed record**: a Money Memo the user explicitly confirmed. Authoritative per
  Principle II.

**Prohibited data classes** — never requested, accepted, or stored: bank credentials, bank
account numbers, payment card numbers, CVV/CVC codes, bank statements, banking access tokens,
government identification numbers.

**Technology boundaries**

- Appwrite is accessed through supported APIs/SDKs only (Principle VI).
- Redis, STT, and AI providers are optional accelerators; their absence degrades features but
  never blocks manual text entry (Principle IV).
- Every provider integration is introduced with a recorded decision covering: training and
  retention controls, failure behavior, and replacement path.

## Development Workflow & Evidence

**Gate order** — a feature advances only when the prior gate passes:

1. Formatting and linting
2. Type checking
3. Unit tests
4. Integration tests
5. Privacy tests (Principle IX)
6. Acceptance evidence per user story

**Evidence requirements**

- Each user story records how its acceptance criteria were verified, including the command
  run and its result.
- Requirements expecting real integration behavior record evidence against the real
  dependency or a contract-verified fake. A passing mock alone does not close such a
  requirement.
- Deletion, retention, and audio-lifecycle behavior (Principles III and V) record evidence
  per specified path, not per happy path.

**Review expectations**

- Planning and review MUST verify compliance against every principle applicable to the change
  and MUST record any exception before merge.
- A change that touches logging, tracing, analytics, or error responses MUST be reviewed
  against Principle I explicitly.

## Governance

This constitution takes precedence over implementation convenience, delivery pressure, and
tooling defaults. Where a principle and a plan conflict, the plan changes.

**Exceptions**: Any violation REQUIRES an explicit documented exception recording (a) the
rationale, (b) the risks accepted, and (c) a removal plan with an owner. Exceptions are
recorded in the feature's plan under Complexity Tracking. An exception without a removal plan
is not an exception; it is a rejected change.

**Amendments and versioning**: Changes to this document REQUIRE a version bump and a
migration-impact review covering affected specs, plans, tasks, and existing data.
Versioning is semantic:

- **MAJOR**: a principle is removed or redefined in a backward-incompatible way, or
  governance rules change incompatibly.
- **MINOR**: a principle or section is added, or existing guidance is materially expanded.
- **PATCH**: clarifications, wording, and non-semantic refinements.

**Compliance review**: Every feature's Constitution Check gate is evaluated against this
file before Phase 0 research and re-evaluated after Phase 1 design. Constitution conflicts
found during analysis are CRITICAL and are resolved by adjusting the spec, plan, or tasks —
never by reinterpreting or silently ignoring a principle.

**Version**: 1.0.0 | **Ratified**: 2026-07-31 | **Last Amended**: 2026-07-31
