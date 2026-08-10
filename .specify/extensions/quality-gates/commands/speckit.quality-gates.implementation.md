---
description: "Read-only gate for implemented scope, checked-task evidence, acceptance, and convergence"
---

# Implementation and Evidence Quality Gate

Run a deterministic, strictly read-only completion gate over active specification, plan, tasks,
implementation, and evidence.

## Safety

- Read only active working-tree artifacts; never inspect Git history, tags, or archived branches.
- Never modify code, requirements, plans, tasks, checkboxes, evidence, or Git history.
- Never mark tasks complete, generate replacement evidence, or weaken failed requirements.
- Run only safe, non-destructive checks explicitly supported by current project artifacts.

## Checks

1. Require complete `spec.md`, `plan.md`, and `tasks.md`; re-run constitution and cross-artifact
   checks first.
2. For every checked task, verify the promised implementation/deliverable exists and the required
   test, review, or manual evidence exists. Checkbox state alone proves nothing.
3. Detect implementation outside selected task scope, unplanned architecture, restored obsolete
   code, and requirements implemented without traceable tasks.
4. Run or inspect the scope-appropriate formatting, lint, type, unit, integration, privacy,
   security, acceptance, deployment, backup/restore, and production-equivalent gates named by the
   plan/tasks. Record skipped or unavailable checks as gaps; never fabricate a pass.
5. Require real-service or production-equivalent evidence wherever the specification requires it;
   mock-only evidence cannot close such requirements.
6. Verify acceptance evidence maps to each independently testable story and applicable degraded,
   recovery, ownership, export, deletion, observability, and provider-privacy scenario.
7. Require all convergence work to be implemented and evidenced. Newly appended or unchecked
   convergence tasks block completion.
8. Detect sensitive data in diagnostics/evidence and any implementation that exceeds selected
   task scope.

## Result Contract

Output concise findings with stable IDs, severity, task/requirement mapping, executed/not-run gate
summary, and residual risks. End with exactly one:

- `GATE: PASS` — no CRITICAL/HIGH findings, required checks pass, and completion evidence exists.
- `GATE: FAIL` — any CRITICAL/HIGH finding, missing required evidence, failed required check, or
  incomplete convergence work exists.

Mandatory callers MUST stop on `GATE: FAIL`. Lower-severity advice is explicitly advisory.
