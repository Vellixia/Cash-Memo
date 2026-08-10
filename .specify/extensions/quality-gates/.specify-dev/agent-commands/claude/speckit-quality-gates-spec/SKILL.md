---
name: speckit-quality-gates-spec
description: Read-only gate for specification quality, clarification completeness,
  and constitution compatibility
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: quality-gates:commands/speckit.quality-gates.spec.md
---

# Specification Quality Gate

Run a deterministic, strictly read-only gate over the active feature specification.

## Safety

- Read only the active working tree and `.specify/feature.json` target.
- Never inspect Git history, tags, archived branches, or removed implementation.
- Never edit requirements, checklists, the constitution, or any generated artifact.
- Never weaken a requirement or invent an exception to obtain a pass.
- Never run planning, task generation, or implementation.

## Required Inputs

Require `.specify/feature.json`, its referenced `spec.md`, the active spec template, and
`.specify/memory/constitution.md`. Fail when a pointer is malformed, escapes the repository,
or references a missing file.

## Checks

1. Verify required template structure exists and contains no unfilled template tokens, TODOs,
   contradictory alternatives, or unresolved `[NEEDS CLARIFICATION]` markers.
2. Verify every user story is independently testable, outcome-shaped, prioritized, and has
   primary, alternate, failure/degraded, privacy, and measurable acceptance coverage.
3. Verify functional requirements and success criteria have unique stable IDs, are testable,
   technology-agnostic where appropriate, and trace to user outcomes.
4. Verify domain terms, state transitions, ownership rules, period/timezone rules, money and
   currency semantics, deletion lifecycle, external-provider boundaries, and out-of-scope limits
   are internally consistent.
5. Compare the specification against every applicable constitution MUST. Treat any conflict as
   CRITICAL. Never reinterpret or amend the constitution inside this command.
6. Reject impossible guarantees. Require each privacy, deletion, availability, offline, and AI
   interpretation statement to be classifiable as hard invariant, best-effort control,
   operational SLO, provider dependency, or known limitation.
7. Verify clarification decisions are incorporated into normative requirements and acceptance
   scenarios without leaving obsolete alternatives or duplicate clarification bullets.
8. Re-evaluate any active requirements-quality checklist. Unchecked mandatory items are HIGH
   unless explicitly documented as advisory with rationale.

## Result Contract

Output concise findings with stable IDs, severity, location, and remediation. End with exactly one:

- `GATE: PASS` — no CRITICAL/HIGH findings and no unresolved clarification markers.
- `GATE: FAIL` — one or more CRITICAL/HIGH findings exist.

Mandatory callers MUST stop on `GATE: FAIL`. Lower-severity advice never mutates files and is
explicitly labeled advisory.