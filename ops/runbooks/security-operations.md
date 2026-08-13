# Security operations

## Export exposure or cross-user incident

Stop affected download/resource path, revoke delivery/session material, preserve content-safe
evidence, and invoke privacy incident procedure. Test ownership/RLS and object policy boundaries
using synthetic canaries. Never place exposed content into tickets, logs, or evidence.

## Rate or provider-spend abuse

Apply deterministic per-principal and coarse global controls. Do not expose account existence or
another user's status. Counters contain no IP, email, memo, amount, search, audio, transcript, or
provider payload.

## S3/KMS, role, or policy drift

Block promotion. Verify public-access blocks, KMS principal boundaries,
runtime/worker/migration/restore separation, GitHub OIDC subject, and break-glass inactivity. Rotate
compromised grants through approved workflow. Do not use break-glass for normal operations.

## Deletion and backup security

Ledger failure blocks irreversible deletion. Copy/snapshot policy drift blocks suppression cleanup
and release. Follow deletion-suppression and backup/restore runbooks; never remove tokens because
retention time elapsed.

## Escalation and closure

Escalate to named security, privacy, release, SRE, data operations, and provider owners according to
impact. Close only after containment, synthetic regression, credential/policy validation, and
content-safe evidence hashes.
