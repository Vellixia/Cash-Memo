# Operations evidence templates

JSON templates are deliberately invalid. Copy outside repository, replace every `REPLACE_WITH_*`,
then sign only after target binding completes. Never store HMAC key, credentials, user IDs, email,
or financial data in templates.

Preservation uses exact `schema_version: 1` keys from `preservation-decision.json`. Set dedicated
`CASHMEMO_V1_PRESERVATION_EVIDENCE_HMAC_KEY` only in command environment; canonicalize with
`jq -S -c 'del(.signature)'`, HMAC-SHA256 it, write fixed lowercase hex signature, then invoke
`scripts/production-replacement-gate.sh` with identical target, Dokploy, and DB bindings.

Restore readiness is wrapper-produced: set restore metadata and
`CASHMEMO_V1_RESTORE_EVIDENCE_HMAC_KEY`, run `scripts/replay-deletion-receipts.sh`, then pass its
atomic artifact to `scripts/verify-restore.sh`. Do not hand-author readiness evidence.
