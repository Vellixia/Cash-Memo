# PostgreSQL migration policy

Committed SQL migrations are immutable after release. Production uses reviewed forward migrations
only; schema push is prohibited.

Feature 001 starts from an empty product schema because Cashmemo has no preceding production
application release. CI still exercises two paths:

1. a clean PostgreSQL 18 database;
2. a separately initialized empty previous-release baseline, followed by the same committed forward
   chain.

`0001_cashmemo_mvp.sql` and `0002_roles_rls.sql` establish foundational data and access controls.
They have no automated down migration because deleting journal tables or weakening RLS would be
destructive. Recovery is safe-forward: stop deployment before application traffic, restore the
pre-deployment RDS snapshot into an isolated environment when investigation needs old state, then
ship a reviewed corrective forward migration. Never network-release a restored copy before
deletion-suppression reconciliation.

`checksums.sha256` is reviewed with every new migration. Released migration files must never be
rewritten; append a new numbered migration and checksum instead.
