# Preservation gate

Before destructive legacy-data action, production migration, replacement deployment, or route
cutover, create operator-signed evidence: operator identity, Dokploy service/config inventory,
actual DB fingerprint, table/row evidence, backup inventory/freshness, time-bounded evidence expiry,
real-data decision, and approval record. Run `scripts/production-replacement-gate.sh` before any
migration/deploy command.

Evidence with `real_user_data: true` stops with exact output
`STOP_REQUIRES_DEDICATED_MIGRATION_PLAN`. It authorizes no action. Unknown, incomplete, invalid, or
stale evidence fails closed. Only explicitly named disposable isolated V1 development/staging
targets skip legacy audit.
