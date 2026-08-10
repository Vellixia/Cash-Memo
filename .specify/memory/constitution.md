<!--
Sync Impact Report
==================
Version change: 1.0.0 → 2.0.0
Bump rationale: Principle I previously imposed universal rejection of prohibited data on
every arbitrary input path. Cashmemo permanently supports free text and voice, where finite
detectors cannot prove complete semantic detection. Replacing that absolute with dedicated-
collection prohibitions, mandatory behavior for supported detectors, and explicit best-effort
limits is a backward-incompatible principle redefinition and therefore requires a MAJOR bump.

Modified principles:
  I. Privacy by Default → I. Privacy by Default (reconciled dedicated collection,
  finite detection controls, diagnostic isolation, and arbitrary-input limitations)

Added sections:
  - none

Removed sections: none

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — Constitution Check resolves principles dynamically;
     no edit required.
  ✅ .specify/templates/spec-template.md — principle-specific privacy controls belong in each
     feature's requirements; no edit required.
  ✅ .specify/templates/tasks-template.md — detector, privacy, and limitation evidence tasks are
     generated from feature requirements; no edit required.
  ✅ .specify/templates/checklist-template.md — no changes required.
  ✅ .agents/skills/speckit-*/SKILL.md and .claude/skills/speckit-*/SKILL.md — all resolve
     constitution rules dynamically; no outdated semantic reference found.
  ✅ Runtime guidance docs — repository has no README.md or docs/ yet; when added, they
     MUST reference this constitution.

Follow-up TODOs:
  ✅ specs/001-cashmemo-mvp/spec.md — FR-077 and Constitution Alignment reconciled during the
    resumed clarification session. Remaining clarifications are unrelated to this amendment.
-->

# Cashmemo Constitution

## Core Principles

### I. Privacy by Default

- Cashmemo MUST NOT intentionally request or encourage users to provide, infer into dedicated
  attributes, or provide dedicated fields for bank credentials, bank account numbers, payment
  card numbers, CVV/CVC codes, full bank statements, banking access tokens, or government
  identification numbers. Cashmemo MUST NOT use any of these data classes to connect to a bank
  or as an intended product input.
- At every persistence or provider-transmission boundary covered by a supported finite detector,
  the detector MUST run before the boundary is crossed. When it identifies candidate prohibited
  content, Cashmemo MUST apply the warning or blocking behavior defined by the governing feature
  specification; it MUST NOT silently persist or transmit the matched candidate first and scrub
  it later. Detector rules, boundary coverage, and warning/blocking behavior MUST be testable.
- Detection within arbitrary free text, transcripts, or natural language is finite and MUST be
  treated as best effort. Specifications, interfaces, evidence, and product claims MUST NOT imply
  complete semantic detection, and MUST disclose material false-positive and false-negative
  limitations for supported detectors.
- Candidate sensitive content, matched values, normalized detector material, and detector
  derivatives MUST NOT enter logs, traces, metrics, analytics, diagnostics, crash reports,
  acceptance evidence, or AI/STT requests unrelated to the user's explicit current capture
  operation. Diagnostics MUST identify operations and records only through content-free values
  and opaque identifiers.
- Every arbitrary free-text, transcript-editing, or voice entry point MUST clearly instruct users
  not to enter sensitive banking, card-secret, statement, access-token, or identity information.
- Data collection MUST be limited to what Money Memo functionality requires. Adding a new
  persisted field REQUIRES an explicit specification entry stating why the feature cannot
  work without it.
- Sensitive financial content — amounts, notes, transcripts, counterparties, category
  detail — MUST NOT appear in logs, traces, metrics, analytics events, crash reports, or
  error messages returned to any client. Diagnostics MUST reference records by opaque
  identifier only.

Rationale: Cashmemo's reason to exist is that recording money does not require handing over
banking access. Product-controlled collection and handling can be absolute; semantic recognition
inside arbitrary language cannot. Strong, testable controls over dedicated fields, detected
candidates, diagnostics, provider boundaries, and user guidance protect the promise without
claiming an impossible universal detector.

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
- Privacy tests MUST at minimum assert that released interfaces contain no dedicated collection
  or solicitation for prohibited data classes; each supported finite detector applies its
  specified warning/blocking behavior before covered persistence and provider boundaries; and
  candidate values, detector material, and sensitive content remain absent from diagnostics,
  evidence, and unrelated provider requests. Evidence MUST also verify that arbitrary-input
  detection is described as best effort rather than semantically complete.
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

**Prohibited data classes** — never intentionally requested or encouraged, inferred into
dedicated attributes, or collected through dedicated fields: bank credentials, bank account
numbers, payment card numbers, CVV/CVC codes, full bank statements, banking access tokens, and
government identification numbers. Arbitrary user text or speech may incidentally contain such
content; Principle I governs user guidance, supported finite detectors, warning/blocking behavior,
provider boundaries, diagnostic isolation, and honest best-effort limitations.

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
- Principle I evidence records each supported detector's covered boundaries and expected
  warning/blocking result, seeded diagnostic and unrelated-provider non-disclosure checks, and
  the measured or documented limits of arbitrary-language detection.

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

**Version 2.0.0 reconciliation record**: Version 1.0.0 required every input path to reject all
prohibited sensitive information before acceptance, transmission, or storage. That universal rule
was structurally incompatible with Cashmemo's permanent arbitrary natural-language text and voice
capabilities because finite detectors cannot prove complete semantic recognition. Version 2.0.0
narrows only that impossible absolute: dedicated collection remains prohibited; supported detector
hits require defined pre-boundary controls; detector and candidate material remains excluded from
diagnostics and unrelated provider requests; user guidance is mandatory; and detection outside
finite rules is explicitly best effort. This amendment is a general product rule, not a Feature 001
exception.

**Compliance review**: Every feature's Constitution Check gate is evaluated against this
file before Phase 0 research and re-evaluated after Phase 1 design. Constitution conflicts
found during analysis are CRITICAL and are resolved by adjusting the spec, plan, or tasks —
never by reinterpreting or silently ignoring a principle.

**Version**: 2.0.0 | **Ratified**: 2026-07-31 | **Last Amended**: 2026-08-09
