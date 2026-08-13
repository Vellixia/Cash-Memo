# Existing PostgreSQL preservation

`cashmemo-test-postgres` (`postgres:18.4-alpine`) and its current persistent volume are an existing
valid development service. Deployment automation must resolve and compare the exact service and
volume IDs before any update. Replacement, recreation, volume rename, or teardown is forbidden.

Permitted non-destructive next-pass changes are an explicit `pg_isready` healthcheck and
`unless-stopped` restart policy. Resource limits remain open until measurement evidence exists.
pgBackRest/WAL integration must be introduced with a rollbackable in-place image/config change that
retains the volume; a verified pre-change backup and successful post-change database/schema probe
are mandatory.
