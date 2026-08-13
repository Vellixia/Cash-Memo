# STT, extraction, and provider configuration outages

## Symptoms and alerts

Provider availability/rate/timeout/invalid-schema alarms or configuration-drift gate failure. Report
core and each provider separately.

## Product behavior

- STT unavailable: delete current temporary audio through lifecycle owner; offer manual text/new
  recording.
- Extraction unavailable: keep permitted recoverable transcript/draft; never confirm partial output.
- Configuration approval mismatch: disable affected adapter before transmission.
- Manual structured journal remains available while auth and persistence are healthy.

## Response

Confirm fixed provider status category and approved decision version. Stop transmission if privacy,
model, endpoint, ZDR, or minimization config is uncertain. Retry only within bounded policy. Do not
send historical journal context. Validate recovery using approved synthetic fixtures; do not claim
real-provider rehearsal unless actually executed.

Escalate to provider, privacy, security, and SRE owners. Evidence contains
operation/status/duration/build/hash only.
