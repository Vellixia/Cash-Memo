---
name: speckit-quality-gates-artifacts
description: Read-only gate for spec-plan-task consistency, coverage, ordering, paths,
  and ownership
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: quality-gates:commands/speckit.quality-gates.artifacts.md
---

# Cross-Artifact and Task Quality Gate

Run a deterministic, strictly read-only gate over active Spec Kit artifacts available at the
current workflow boundary.

## Safety

- Read only the active working tree and `.specify/feature.json` target.
- Never inspect Git history, tags, archived branches, or removed implementation.
- Never edit spec, plan, tasks, checklists, constitution, or source code.
- Never generate tasks, mark tasks complete, or start implementation.

## Prerequisites by Boundary

- After plan / before tasks: require stable `spec.md` and complete `plan.md`.
- After tasks / before implement: also require complete `tasks.md`.
- If caller boundary is unclear, use available artifacts and fail when a prerequisite needed for
  the requested transition is absent.

## Checks

1. Re-run specification and constitution compatibility checks; any constitution conflict is
   CRITICAL.
2. Verify every plan decision traces to a current requirement, respects scope, records material
   assumptions, and introduces no speculative architecture or silent product decision.
3. Verify spec and plan agree on entities, lifecycle, ownership, privacy boundaries, external
   providers, degraded behavior, deterministic calculations, deployment, and evidence.
4. When tasks exist, map every FR, buildable SC, story, privacy invariant, contract, operational
   requirement, acceptance scenario, and manual approval to implementation and verification
   ownership.
5. Verify dependency ordering and detect cycles. Any cycle is CRITICAL.
6. Verify `[P]` tasks are actually parallel: no same-file conflict and no unresolved dependency.
7. Verify task paths and deliverables are concrete, repository-valid, and sufficient to prove
   completion; detect placeholder tasks, fake evidence, and unverifiable verbs.
8. Require tests/manual ownership appropriate to each requirement. Flag requirements with only
   implementation ownership, only mock evidence where real behavior is required, or no owner.
9. Before implementation, require zero unresolved CRITICAL/HIGH findings and all required plans,
   contracts, and task-verification artifacts.

## Result Contract

Output concise findings with stable IDs, severity, artifact locations, coverage summary, and cycle
summary. End with exactly one:

- `GATE: PASS` — no CRITICAL/HIGH findings and zero dependency cycles.
- `GATE: FAIL` — one or more CRITICAL/HIGH findings or any dependency cycle exists.

Mandatory callers MUST stop on `GATE: FAIL`. Lower-severity advice is advisory and read-only.