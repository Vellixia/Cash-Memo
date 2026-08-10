# PostgreSQL migration policy

Committed SQL migrations are immutable after release. Production uses reviewed forward migrations
only; schema push is prohibited.

Feature 001 has not launched, but accepted implementation migrations are still treated as immutable.
CI exercises two paths:

1. a clean PostgreSQL 18 database;
2. a separately initialized accepted pre-0003 schema with representative synthetic identity rows,
   followed by `0003_better_auth_compat.sql`.

`0001_cashmemo_mvp.sql` and `0002_roles_rls.sql` establish foundational data and access controls and
must not be rewritten. `0003_better_auth_compat.sql` converts legacy email-verification truth into
Better Auth's boolean authority, adds Better Auth core fields, removes unsupported duplicate fields,
and deliberately invalidates outstanding legacy verification actions that cannot be losslessly
converted. User, credential, session, profile, preference, and journal rows survive. Users request a
new verification/reset action if a pre-0003 action was outstanding.

`0004_identity_access_boundary.sql` introduces a dedicated `cashmemo_identity` database principal
for Better Auth pre-auth and authentication-storage operations. This role is narrowly scoped to the
four Better Auth core tables (`users`, `credential_accounts`, `sessions`, `verification_tokens`)
plus signup-scoped idempotency access. It is NOSUPERUSER, NOBYPASSRLS, non-owner, and confined from
all application/domain tables. `cashmemo_runtime` access to `sessions`, `credential_accounts`, and
`verification_tokens` is revoked. Future search projection work starts at
`0005_search_projection.sql`.

Migrations have no automated down migration because deleting journal tables or weakening RLS would
be destructive. Recovery is safe-forward: stop deployment before application traffic, restore the
pre-deployment RDS snapshot into an isolated environment when investigation needs old state, then
ship a reviewed corrective forward migration. Never network-release a restored copy before
deletion-suppression reconciliation.

`checksums.sha256` is reviewed with every new migration. Released migration files must never be
rewritten; append a new numbered migration and checksum instead.
