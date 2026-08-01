# C-07 Control Register

Status: approved Feature 001 constitution exception; release-blocking and not inherited by future
features. Review date: at least annually and before every material free-text, detector, copy,
telemetry, crash-reporting, storage, or trust-boundary change.

## Violation and accepted risk

Constitution v1.0.0 Principle I universally prohibits accepting prohibited banking content.
Arbitrary user-authored text plus finite deterministic detection can produce false negatives.
Accepted risks: undetected prohibited content may be transmitted/persisted; valid text may warn or
block; published patterns may aid evasion. Discovery of prohibited persisted content is a privacy
incident, never evidence that collection was intended.

## Controls and traceability

| Control | Delivery tasks | Verification/owner |
|---|---|---|
| Never request, encourage, infer, or provide dedicated banking fields | T006, T008, T010, T076–T078 | Product + feature owner; release UI review |
| Adjacent warning at every free-text entry | T065, T076, T077 | Product + QA; US1 acceptance |
| Exact versioned Pattern Set v1, client preflight and server enforcement | T027, T054, T055, T057, T061, T063, T065–T067, T071–T072 | Security + Backend/Web |
| Byte-exact local input preservation and correction path | T062–T064, T074–T078 | Web + QA |
| No candidate or detector derivative in diagnostics/evidence | T014, T027, T034, T054–T056, T061, T063–T064, T072, T079 | Security + QA |
| Honest false-positive/false-negative report; no completeness claim | T010, T012, T065, T079, T249 | Product + Security |
| Privacy incident path for later discovery | T012, T252 | Security |

## RACI

- Product: accountable for exception, warning copy, and constitution-amendment proposal.
- Security: accountable for detector definition, threat review, evidence, incident response, and
  annual review.
- Feature owner: responsible for warning/correction UX and implementation traceability.
- QA: responsible for fixture and zero-disclosure evidence.
- Legal/Privacy: consulted for material policy or prohibited-data-class change.

## Review evidence

Store signed annual and material-change decisions under `docs/evidence/001/governance/c07/`.
Each record includes date, reviewers, diff scope, fixture results, privacy scan, known false results,
accepted-risk decision, next review, and open removal work. Detector IDs may appear only in reviewed
control documents; candidate content or derivatives never appear in evidence.

## Removal conditions

C-07 closes only when an approved constitution amendment explicitly defines enforceable arbitrary
free-text handling, or Feature 001 removes arbitrary free text. Detector improvement alone cannot
close it. Product and Security jointly own amendment/removal proposal and migration-impact review.

