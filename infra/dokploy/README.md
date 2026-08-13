# Dokploy handoff

These files are repository inputs for a later approved Dokploy MCP pass. They were not applied while
being authored. The existing project/environment are `cashmemo` / `development`; exact resource IDs
are protected deployment inputs, not defaults embedded here.

The deployment pass must preserve `cashmemo-test-postgres` and its volume. It deploys API, Worker,
and one-shot migration from the same `sha256:` Cashmemo image identity, then the pgBackRest and
verifier artifacts. Existing RustFS Primary and Secondary Development are endpoint dependencies, not
Compose-owned services. Shared Infisical and OTel/OpenObserve are reused. No duplicate database,
storage, or shared control-plane service is created.

RustFS `1.0.0-rc.1` is pre-release. It is approved only as a development integration target.
Production promotion stays blocked. Both RustFS services are private, have distinct credentials, RPC
secrets, and volumes, expose no console/domain, and store no raw audio. Secondary Development is on
the same physical host and therefore is not production DR.

`production-inputs.example` and `environment.example` contain names/safe markers only. Infisical or
the protected Dokploy environment injects values. Never commit a rendered file.

## Immutable artifact contract

The next Dokploy pass consumes three GHCR digests from one exact reviewed commit:

- `ghcr.io/vellixia/cashmemo-runtime@sha256:…` for API, Worker, and migration;
- `ghcr.io/vellixia/cashmemo-pgbackrest@sha256:…` for fixed backup/check/restore commands;
- `ghcr.io/vellixia/cashmemo-verifier@sha256:…` for synthetic development verification only.

Each workload receives its own protected environment file according to `environment-contract.json`.
The verifier may idempotently create only configured export, content-safe evidence, pgBackRest
repository, and deletion-ledger buckets. It enables versioning and never creates public policies or
raw-audio storage. Its `stories` mode includes Chromium for Playwright journeys. Child-suite output
is suppressed; fixed aggregate status is the only verifier diagnostic output.

The pgBackRest image exposes `archive-push`, but continuous WAL archiving is not deployable merely
by starting a sidecar: PostgreSQL's `archive_command` must execute an approved pgBackRest client in
the PostgreSQL runtime. The preserved `postgres:18.4-alpine` service does not currently contain that
client. `pgbackrest-jobs.json` therefore fails this relationship closed as
`BLOCKED_POSTGRES_ARCHIVE_CLIENT_COLOCATION`; successful sidecar startup is not PITR evidence.
