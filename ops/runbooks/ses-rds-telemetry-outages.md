# SES, RDS, and telemetry outages

## SES

Use generic enumeration-safe responses. Queue/retry only bounded content-free delivery state. Do not
log destination or link. Signup/reset requiring delivery remains unavailable until verified;
existing manual journal sessions remain independent.

## RDS

Fail protected reads/writes closed. Prevent local authoritative fallback. Use Multi-AZ recovery
first; use isolated restore procedure only when required. Before network release, run account-first
and memo suppression reconciliation, RLS checks, migration/schema checks, and deterministic
integrity checks.

## Telemetry

Drop or bounded-buffer allowlisted signals only. Never queue request bodies, errors, URLs, financial
values, or provider payloads. Telemetry failure must not block healthy core journal operations.

## Validation and evidence

Fault-control rehearsal covers alert, containment, recovery, backlog drain, and safe evidence.
Escalate by affected capability. Store fixed codes, counts, durations, build/environment, and hashes
only.
