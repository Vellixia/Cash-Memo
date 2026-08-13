# Operations Plan: Cashmemo MVP

## Service Topology and Ownership

One immutable image serves the PWA/API and starts API or worker roles. One private PostgreSQL 18 database is the product datastore. RustFS Primary stores exports and approved content-safe evidence; separate RustFS Secondary stores encrypted pgBackRest/WAL and content-free deletion reconciliation records. OpenAI and Cloudflare Email sit behind project-owned adapters. Existing shared Infisical and OTel/OpenObserve are connected, not duplicated.

Required accountable roles before task closure:

| Area | Accountable role |
|---|---|
| Product/API release | Release owner |
| Privacy/detectors/providers | Privacy owner |
| Auth/RLS/application security | Security owner |
| Dokploy/deployment/shared monitoring | SRE owner |
| Database/migration/restore | Data operations owner |
| STT/AI adapters | Provider integration owner |
| Accessibility/usability | Accessibility and product research owners |

Named humans/teams are assigned in tasks/evidence, not guessed in planning.

## Operational SLOs and Alerts

| Capability | Objective | Measurement | Mandatory alert |
|---|---|---|---|
| Core manual journal | ≥99.5% monthly excluding announced maintenance | authenticated synthetic create/read plus API SLIs | burn-rate alerts separate from providers |
| Core interactions | p95 ≤2s at normal load and 10k memos/account | browser + server latency | p95/p99/error burn |
| Text extraction | ≥90% review/correction ≤10s normal provider conditions | synthetic real-provider probe | capability latency/error; never core outage |
| Voice result/failure | ≥90% ≤20s after recording normal conditions | synthetic real-provider probe | STT/AI stage health separately |
| Raw audio terminal deletion | target ≤5m; hard maximum 1h | owner metadata + direct absence probe | any delete failure; oldest audio age ≥15m warning, ≥45m critical |
| Draft/derived cleanup | inaccessible immediately; live removal ≤24h | lifecycle backlog age | oldest due item ≥6h warning, ≥18h critical |
| Record/account live purge | ≤24h normal operation after due point | purge state/backlog | any failed stage; oldest due ≥6h warning, ≥18h critical |
| Export package deletion | ≤24h after cancel/expiry | job/object version reconciliation | oldest due ≥6h warning, ≥18h critical |
| Suppression cleanup | never before 42d; only after verified absence of every resurrection-capable copy | full PostgreSQL/pgBackRest/RustFS/local-copy lineage inventory per token | any stale/incomplete/unavailable/unverifiable inventory, policy violation, capable copy, or removal failure retains token and alerts |
| Backup RPO/RTO | RPO ≤24h, RTO ≤8h | quarterly isolated drill | backup failure immediate; missed drill critical |
| Provider retention approval | valid continuously | config/decision version check | mismatch/expiry blocks adapter and launch |

Availability dashboards show core, STT, AI, email, export, and lifecycle health separately. A provider outage cannot lower or conceal the core metric and must not be presented as normal.

## Monitoring Design

### Logs

Allowlisted structured events only: timestamp, build, environment, operation code, coarse result/error class, duration bucket, opaque correlation ID. No HTTP body/query, SQL parameter, provider body, email/IP/user-agent, financial value, detector detail, or stack locals. Retention: 30 days hot, then deletion unless a content-free security record has separately approved retention.

### Metrics

Counters/histograms/gauges for request result/latency, auth coarse outcomes, DB pool, job queue depth/oldest age, lifecycle backlog, audio age/state, provider health/latency/result, export state, backup/restore status, and deployment health. Labels are fixed low-cardinality enums; never user/resource IDs or input values.

### Traces

Sampling favors errors/slow operations through coarse status only. Span names/attributes are a fixed registry. Database statements/parameters, URLs with queries, headers/cookies, provider payloads, and exception messages are disabled/sanitized at source. Opaque IDs rotate and cannot be joined to content without protected application access.

### Client diagnostics

No replay, DOM capture, arbitrary breadcrumbs, or console forwarding. The PWA reports only build/browser-family, stable screen/operation code, coarse capability/error, and timing. User chooses separate support contact; journal content is never auto-attached.

## Runbooks Required Before Launch

Implementation must create, rehearse, and version:

1. environment bootstrap and drift detection;
2. secrets rotation and suspected credential exposure;
3. migration deploy, migration failure, rollback, and safe-forward;
4. Dokploy health rollback and release safe-forward;
5. core journal outage;
6. STT outage and AI outage, separately and together;
7. Cloudflare Email verification/reset outage;
8. PostgreSQL saturation/failover/corruption suspicion;
9. audio deletion failure/oldest-age alarm;
10. draft/record/export/account purge backlog or failed stage;
11. provider retention/training configuration drift;
12. export object exposure or deletion failure;
13. backup failure and quarterly restore;
14. deletion reconciliation after restore;
15. privacy incident for discovered prohibited persisted content;
16. cross-user isolation/security incident;
17. RustFS/pgBackRest/runtime-secret injection failure;
18. rate-limit/abuse event without account enumeration.

Every runbook declares trigger, user impact, owner/escalation, read-only diagnosis, safe mitigation, rollback, evidence allowed, communications, and closure verification. No runbook asks operators to paste journal content, provider payloads, detector values, or exports into tickets/chat.

## Temporary Audio Operations

- Admission rejects >60 seconds, >10 MiB, unsupported/mismatched content, insufficient bounded memory/storage, or unavailable lifecycle owner.
- Owner registers content-free metadata before accepting bytes and sets `expires_at≤created_at+1h`.
- Success, cancellation, unrecoverable failure, request abort, and deadline all enter `deleting` in `finally`.
- A minute sweeper rejects use at expiry and deletes material. Process start scans its ephemeral directory. Fargate essential-container exit destroys task storage; a replacement task has no access to it.
- An external synthetic probe exercises all four constitutional deletion paths and direct absence. Metadata `delete_failed` is never converted to success.
- Audio is absent from object-store inventory, DB schema, backups, traces, crash dumps, and evidence; release scans verify absence.

## Deletion Operations

### Record purge

The state transition makes a record inaccessible immediately. Before hard deletion, the worker derives `HMAC-SHA-256(suppression_key, "money_memo:" || canonical_memo_uuid)`, conditionally writes the content-free `money_memo` ledger record to RustFS Secondary, and verifies body checksum/version durability. If the outcome fails or is ambiguous/unverifiable, the memo remains inaccessible in `purging`; hard deletion waits and alerts. After success, the worker deletes memo content, search vector, related drafts/transcripts/AI metadata, export inclusion on future snapshots, and any provider-deletable state. Failed stage remains retryable/escalated and cannot claim completion.

### Account purge

After seven-day grace:

1. atomically enter irreversible `purging`, revoke sessions/tokens, and deny journal access;
2. cancel/delete export packages;
3. derive `HMAC-SHA-256(suppression_key, "account:" || canonical_account_uuid)`, durably write and verify the content-free `account` ledger record in separate RustFS Secondary storage; if this fails or is ambiguous, remain inaccessible in `purging` and do not hard-delete;
4. delete drafts, captures, provider state, memos, labels, preferences/profile, credentials/email;
5. reconcile RustFS object versions and provider deletion/not-required status;
6. verify absence through owner-scoped probes;
7. report live purge and provider pending/confirmed separately;
8. complete only when every mandatory live stage succeeds.

Jobs use deterministic dedupe keys and idempotent absence-as-success rules. They never recreate missing content.

### Backup interaction

pgBackRest backup/WAL recoverability is bounded to 35 days maximum by reviewed retention and verified repository inventory. User disclosure distinguishes live purge from encrypted backup aging.

Deployment policy prohibits unregistered pgBackRest repositories, manual/operator/volume backup copies, replicas, and restore copies. Runtime/deploy roles cannot create unregistered copies; inventory and alert checks block release/cleanup on violations. Production database deletion is denied outside break-glass procedure. A discovered unregistered or unverifiable artifact is resurrection-capable until verified destroyed.

Isolated PITR/restore copies are permitted only for drills/incidents. They carry immutable source-lineage/recovery-time tags, are registered in the restore inventory before access, remain network-isolated until release approval, and are deregistered only after verified destruction. Abandoned copies remain cleanup blockers.

Suppression record contains only `deletion_token`, `entity_type`, suppression-key version, purge time, `removal_not_before_at`, policy version, and content-free verification state. Token is exactly `HMAC-SHA-256(suppression_key, entity_type || ":" || canonical immutable UUID)`. It contains no raw account/memo ID, email, financial value, journal metadata, or content derivative. Separate injected HMAC keys and purge/restore roles protect the encrypted RustFS Secondary ledger. Forty-two days is minimum removal time, not expiry; no object lifecycle deletes ledger objects.

### Suppression cleanup verifier

After `removal_not_before_at`, privileged scheduled verification:

1. identifies product DB lineage and purge time from content-free policy metadata;
2. enumerates pgBackRest backup sets, WAL recovery windows, and every Secondary object version;
3. inventories local repositories, manual/operator/volume copies, replicas, restore copies, and policy violations;
4. inventories every active isolated restore instance/cluster and confirms its source recovery point cannot contain pre-purge data—or requires its verified destruction;
5. requires authoritative inventory APIs/config checks to succeed and proves every artifact capable of restoring state from before the purge is outside recovery or absent;
6. only after all checks pass, marks `verified_eligible`, deletes the ledger object with version verification, and records content-free removal evidence;
7. on any capable artifact, unknown lineage, API failure, stale inventory, policy drift, removal failure, or unavailable key version, marks `blocked`, retains token and key, raises alert, and retries. Cleanup remains incomplete.

Suppression keys cannot rotate out of availability while records under that version remain. A key rotation creates a new active version and retains prior versions for restore matching/cleanup verification.

## Backup and Restore Procedure

Declared disaster: loss/corruption of primary PostgreSQL requiring pgBackRest target-time restore from an independent-failure-domain repository while application artifacts and suppression ledger remain available.

1. Declare incident and record content-free recovery target/backup age.
2. Block public traffic and deploy restore environment in isolated subnets.
3. Restore latest valid point meeting RPO, validate encryption and migration checksum.
4. revoke all restored Better Auth sessions and one-time/reauthentication tokens and block outbound provider work;
5. load every relevant suppression-key version and ledger record, compute `account` tokens for restored users, purge matching account graphs, then compute `money_memo` tokens for remaining restored memos and purge exact matches plus related state;
6. run all expired lifecycle sweepers at current time;
7. verify RLS with two accounts, cross-owned references, currency registry/version, exact totals, search isolation, export ownership, and zero suppressed account or memo identity;
8. compare object/provider reconciliation and resolve required gaps;
9. record RPO/RTO and content-safe evidence;
10. privacy/security/data-operations owners approve release; then shift traffic;
11. monitor synthetic core/provider/lifecycle probes; keep this restore copy inventoried while active; securely destroy failed/drill resources and verify destruction so they cannot block or evade later suppression cleanup.

Quarterly drills alternate representative failure points, including backups predating an individual memo purge and account deletion. Pass requires RPO ≤24 hours, RTO ≤8 hours, zero memo/account resurrection, zero isolation failure, exact golden totals, and verified restore-copy destruction. Separate cleanup drills prove every capable/unverifiable artifact retains suppression token and alerts.

## Deployment and Migration

- OpenTofu plans are reviewed; production apply requires protected workflow and plan digest.
- Image is pinned by digest, non-root, read-only root filesystem, minimal capabilities, SBOM attached.
- One-shot migration task uses a separate role and advisory lock. API/worker versions check compatible schema at startup and fail closed.
- Expand/contract changes maintain prior-release compatibility through rollback window. Destructive schema cleanup follows proven migration/backfill and backup-retention analysis.
- Dokploy health policy rolls API and worker back to the previous immutable digest when schema-compatible; synthetic post-deploy verifies manual journal first, then providers. Feature flags may disable providers, never privacy/auth/confirmation/deletion controls.
- No silent partial release: build/config/migration/provider decision/currency registry versions appear in the content-safe release manifest.

## Secrets and Access

The existing shared Infisical service injects secrets at runtime with least privilege. Separate capabilities exist for runtime API, worker purge, migration, restore, CI artifact publication, Dokploy deploy, and human break-glass. RustFS Primary paths, Secondary deletion ledger/backup repository, and evidence use separate credentials/namespaces. OpenAI project key is restricted/rotated; no default developer key can run production.

Better Auth's core PostgreSQL `session.token` is supported bearer material, not a Cashmemo-hashed lookup value. Only Better Auth's identity DB role may read/write it; operators, analytics, evidence, SQL telemetry, support tooling, and general application repositories cannot select it. PostgreSQL storage and pgBackRest repositories are encrypted. Session-table exposure is treated as credential exposure requiring supported revoke-all and key/session rotation procedures.

Secret scans run pre-commit/CI/image. Detection blocks release and starts rotation; test output never prints suspected secret. Break-glass access is time-bound, approved, audited content-free, and reviewed.

## Incident Handling for Prohibited Persisted Content

1. Do not copy content into diagnostics/tickets. Use protected resource ID and content-free incident code.
2. Contain affected boundary/provider and suspend it without disabling safe manual journal unless necessary.
3. Privileged privacy responder validates in the product store under access controls; no broad export.
4. Offer user correction/deletion and execute affected live/provider purge.
5. Determine provider notification/deletion requirement through provider decision record.
6. inspect detectors/boundary coverage using synthetic reproduction; do not create a semantic-completeness claim;
7. protect incident evidence from content/detector derivative leakage;
8. governance/privacy/security review approves control/product-copy changes before reenabling.

## Cost Guardrails

Budgets/alarms cover API/worker health, PostgreSQL storage/IO/connections, RustFS versions, pgBackRest backup/WAL age, provider tokens/audio, Cloudflare email volume, and telemetry ingestion. Provider requests have per-account/global rate and spend limits. Cost control may degrade STT/AI explicitly but cannot disable manual capture, deletion, export access to ready packages, privacy checks, or isolation.

## Production Acceptance Evidence

Operations signs only when:

- exact infrastructure/migration/image/provider/config versions recorded;
- real end-to-end and degraded journeys pass;
- core and provider SLI dashboards/alerts fire correctly;
- audio/lifecycle/export/account deletion probes meet targets;
- most recent isolated restore meets RPO/RTO and no-resurrection checks;
- rollback/safe-forward proven;
- evidence scanner finds no content/canary/secret;
- mandatory hooks and CRITICAL/HIGH finding gates are clear.
