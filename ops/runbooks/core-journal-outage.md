# Core journal outage

## Scope

RDS failure, Better Auth failure, migration mismatch, ECS failure, and ALB failure. Core outage
differs from provider degradation: authoritative reads/writes fail closed; device drafts may remain
recoverable but never become authoritative.

## Detect and assess

- Signals: core availability/error burn, ALB unhealthy targets, ECS circuit breaker, RDS events,
  migration compatibility failure.
- Record only operation code, component, coarse state, build, environment, duration, and opaque
  incident ID.
- Confirm scope using synthetic health and DB connection/role checks. Never query or copy user
  content into incident tooling.

## Contain and recover

1. Stop release/promotion and suspend incompatible tasks.
2. For ALB/ECS failure, restore previous compatible immutable task definition.
3. For migration mismatch, use deployment rollback/safe-forward runbook; no automatic destructive
   rollback.
4. For RDS failure, follow backup/restore runbook in isolated network and reconcile suppression
   before release.
5. For auth failure, deny protected access; never create anonymous/shared fallback.

## Validate and close

Validate health, auth denial/success, RLS isolation, manual create retry, history, and job backlog
with synthetic accounts. Escalate to release, SRE, security, and data operations owners. Store
content-safe evidence only.
