# Task 9 report: Canonical request IDs and safe request logs

## Root cause

Restricted auth handlers minted new request IDs instead of consuming attached ID. Auth extractor,
origin middleware, rate-limit middleware, and request logger also had fallback construction paths.
One request could therefore have distinct header/body/log IDs. Logs lacked method, matched route,
service, and version.

## RED

- `restricted_auth_routes_and_extractor_reuse_attached_request_id` failed: restricted
  `/sessions/current` body contained a fresh UUID instead of incoming canonical UUID.
- `request_log_has_only_canonical_operational_fields` failed: structured event fields were only
  `event`, `latency_ms`, `request_id`, and `status`.

## GREEN

Request-ID attachment stays outermost. Auth handlers/extractor and origin/rate-limit/logger paths
now require attached `RequestId`; no error path creates a second ID. Logger records only canonical
operational fields and uses `MatchedPath`, with `<unmatched>` fallback.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57433/cashmemo_e2e cargo test -p cashmemo-api --test http_safety --test operations --test auth -- --test-threads=1`

Result: 41 passed: auth 15, http_safety 13, operations 13. Serial execution avoids SQLx
temporary-database cleanup collision seen in parallel run.

## Log privacy evidence

Real TCP test sends body/query values for password, token, note, and amount to both matched and
hostile unmatched URLs. Captured structured logs assert:

- matched `GET` route `/api/v1/health/live`;
- unmatched `POST` route `<unmatched>`;
- `request_id`, `method`, `route`, `status`, `latency_ms`, `service`, and `version` fields;
- no raw URI/query prefix, password, token, note, amount, cookie, session, reset, or verification
  token value in captured output.

## Cleanup

Used only `cashmemo-pr3-task9`, service `postgres`, port `57433`.
`docker-compose -p cashmemo-pr3-task9 -f infra/v1/test-compose.yml down --volumes --remove-orphans`
removed its container and network. Follow-up `ps -a` returned empty table.

## Changed files

- `apps/api/src/app.rs`
- `apps/api/src/auth/model.rs`
- `apps/api/src/auth/routes.rs`
- `apps/api/src/http/origin.rs`
- `apps/api/src/http/rate_limit.rs`
- `apps/api/tests/auth.rs`
- `apps/api/tests/http_safety.rs`
- `apps/api/tests/operations.rs`
- `docs/verification/v1-pr3-repair-evidence.md`
- `.superpowers/sdd/2026-08-25-cashmemo-v1-pr3-repair/task-9-report.md`

## Self-review

Checked formatter, whitespace, scoped diff, canonical-ID source audit, matched/unmatched route
privacy assertions, full required suites, and no production/Dokploy/push/merge change. Existing
untracked `.serena/` remains untouched.

## Commit

Signed commit subject: `fix: keep request IDs consistent in errors and logs`.
