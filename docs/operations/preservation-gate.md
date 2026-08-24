# Preservation gate

Before destructive legacy-data action, production migration, replacement deployment, or route
cutover, create schema-versioned canonical evidence: target class/ID, operator/approval identity,
Dokploy service/config digest, actual DB name/fingerprint, complete table/row inventory, backup
ID/freshness, real-data decision/disposition, issued/expiry timestamps, and HMAC-SHA256 signature.
Signature key is dedicated command environment only; never store it in evidence or logs. Gate binds
evidence to expected target, Dokploy service/config, and DB identifier before any migration/deploy
command.

Evidence with `real_user_data: true` stops with exact output
`STOP_REQUIRES_DEDICATED_MIGRATION_PLAN`. It authorizes no action. A nonempty target with
`real_user_data: false` must carry explicit `development_data_disposable` disposition. Unknown,
forged, incomplete, mismatched, future-incoherent, or stale evidence fails closed. Only explicitly
named disposable isolated V1 development/staging targets skip legacy audit.
