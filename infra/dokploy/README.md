# Dokploy handoff

These files are repository inputs for a later approved Dokploy MCP pass. They were not applied while
being authored. The existing project/environment are `cashmemo` / `development`; exact resource IDs
are protected deployment inputs, not defaults embedded here.

The deployment pass must preserve `cashmemo-test-postgres` and its volume. It deploys API and Worker
from the same `sha256:` Cashmemo image identity, then the pinned RustFS development services and
pgBackRest integration. It reuses shared Infisical and OTel/OpenObserve endpoints. It creates no
duplicate PostgreSQL or shared control-plane service.

RustFS `1.0.0-rc.1` is pre-release. It is approved only as a development integration target.
Production promotion stays blocked. Both RustFS services are private, have distinct credentials, RPC
secrets, and volumes, expose no console/domain, and store no raw audio. Secondary Development is on
the same physical host and therefore is not production DR.

`production-inputs.example` and `environment.example` contain names/safe markers only. Infisical or
the protected Dokploy environment injects values. Never commit a rendered file.
