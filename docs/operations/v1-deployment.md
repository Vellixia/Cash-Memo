# Cashmemo V1 deployment operations

## Runtime boundary

Long-running topology is exactly `cashmemo-v1-web`, `cashmemo-v1-api`, and isolated
`cashmemo-v1-postgres`. There is no Redis, permanent migration/job service, metrics stack, or
application backup credential. The API image exposes `serve`, explicit one-shot `migrate`, and
bounded scheduled commands.

Copy `infra/v1/env.example` into Dokploy secrets/config and replace every placeholder. Web/API serve
must never receive deletion-receipt or backup/S3 credentials. Only `purge-accounts` receives the
dedicated receipt prefix credentials and HMAC key ring. Keep database and receipt credentials out of
build arguments and image layers.

The API serve allowlist is `CASHMEMO_V1_DATABASE_URL`, `CASHMEMO_V1_BIND_ADDR`,
`CASHMEMO_V1_PUBLIC_ORIGIN`, cookie/session settings, SMTP/email settings, `CASHMEMO_V1_APP_ENV`,
`CASHMEMO_V1_LOG_LEVEL`, auth rate limits, and `CASHMEMO_V1_ARGON2_*`. Bind address is a required
non-secret container reachability control. Argon2 memory/time/parallelism are non-secret runtime
controls that must be benchmarked and tuned on the actual production host while retaining approved
security floors. Neither expands the financial-data or backup-secret boundary.

## Build, identify, and migrate

Build both images from repository root:

```sh
docker build -f infra/v1/api.Dockerfile -t registry.example/cashmemo-v1-api:release .
docker build -f infra/v1/web.Dockerfile -t registry.example/cashmemo-v1-web:release .
docker push registry.example/cashmemo-v1-api:release
docker push registry.example/cashmemo-v1-web:release
```

Resolve registry digests after push. Record exact API and web `repository@sha256:...` values in
deployment evidence before starting or updating services. Set `CASHMEMO_V1_API_IMAGE` and
`CASHMEMO_V1_WEB_IMAGE` to those immutable values; a mutable tag alone is not deployable evidence.
Also record previous deployed digests for rollback.

Run `migrate` once with only `CASHMEMO_V1_DATABASE_URL`, using the exact API digest selected for
deployment. Migration is never a permanent service and must complete successfully before API
replacement:

```sh
docker run --rm --network "${CASHMEMO_V1_PRIVATE_NETWORK:-cashmemo-v1-private}" \
  -e CASHMEMO_V1_DATABASE_URL \
  "$CASHMEMO_V1_API_IMAGE" migrate
```

Production replacement and routing require the separate preservation gate before this command. Task
20 verification does not deploy, migrate production, or activate routes.

## Health and shutdown

- `GET /api/v1/health/live` checks process liveness only and remains healthy during DB loss.
- `GET /api/v1/health/ready` executes a minimal DB query and returns `503` when PostgreSQL is not
  ready.
- Compose/Dokploy health uses `/api/v1/health/ready`, so DB loss removes API from routing. Operators
  may probe `/api/v1/health/live` separately when diagnosing process liveness.
- API handles SIGTERM with graceful connection draining. Compose grants 30 seconds; PostgreSQL gets
  60 seconds. Dokploy should remove a replica from routing on readiness failure before termination.

Do not put receipt/S3 checks in readiness. Those dependencies belong only to scheduled commands.

## Dokploy schedules

Create Dokploy schedules from the API image digest. Each invocation is a fresh one-shot container,
has a hard platform timeout, and must exit after its bounded batch. Suggested starting cadence:

| Schedule     | Command                                                                             | Scope                                          |
| ------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| Every minute | `process-recurring --batch-size 500 --max-occurrences-per-recurring-transaction 50` | DB only                                        |
| Hourly       | `purge-accounts --batch-size 100`                                                   | DB plus deletion-receipt credentials/HMAC keys |
| Daily        | `purge-trash --batch-size 500`                                                      | DB only                                        |
| Daily        | `cleanup-auth-tokens --batch-size 1000`                                             | DB only                                        |

Commands reject zero and values above compiled safety ceilings. Success emits one JSON summary with
only `command` and `processed`. Alert on nonzero exit, timeout, missing run, or repeated batches at
the configured maximum. Never log command environment.

## Logs and evidence

API request events are JSON and contain only `event=http_request`, canonical `request_id`, numeric
HTTP `status`, and `latency_ms`. They omit bodies, query strings, user identifiers, passwords,
tokens, notes, amounts, and financial request/response content. Do not enable proxy body logging or
user-level analytics. Retain logs according to operator policy with access controls.

Images run as non-root users and application roots are read-only with a bounded `/tmp`; CPU/memory
limits and local log rotation are proportional defaults to tune from load evidence. Before launch,
validate Compose and images, record image digests, and preserve health/log samples.

Where existing CI/registry tooling supports it, generate and retain an SBOM, run image scanning, and
review/pin base-image digests. These are best-effort integrations for this task, not launch
blockers. Deployed application image digest recording is always required.
