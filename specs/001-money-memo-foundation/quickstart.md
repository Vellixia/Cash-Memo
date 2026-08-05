# Quickstart Validation Guide: Money Memo Foundation

This guide defines runnable validation interface implementation must supply. It validates feature
end to end; it does not contain application implementation. Source/`just` targets do not exist at
planning time and are created only after pre-task limit decisions in `plan.md` are accepted.

## Prerequisites

- Docker + Docker Compose
- `just`
- Node.js 24 LTS with project package manager lockfile
- Rust 1.97.1 from repository `rust-toolchain.toml`
- Pinned Appwrite 1.9.6 image digest
- Local S3-compatible test bucket with versioning/lifecycle test support
- OpenTelemetry Collector and OpenObserve test containers
- Browser engines installed by Playwright

Never use Appwrite internal MongoDB shell, driver, dump, or direct query. Provision/inspect schema
through supported Appwrite APIs/CLI only. Backup tests use opaque quiesced volumes/system snapshot.

## Configure local secrets

Create runtime secrets through project secret bootstrap target:

```bash
just secrets-dev-init
```

Expected result:

- random fingerprint KEK, purge-token key, cursor key, Appwrite server credential, cookie secret;
- secrets stored in ignored local secret directory with restrictive permissions;
- no value printed to terminal/log;
- `just secrets-scan` reports zero committed secrets.

`APPWRITE_SERVER_API_KEY` is created only by supported Appwrite bootstrap APIs and stored in the
separate ignored `config/local-secrets/appwrite-runtime.env`. Validate both files without exposing
values after bootstrap:

```bash
just environment-check
```

Do not copy example values into version control.

## Start real local stack

```bash
just appwrite-ready
docker compose --env-file config/local-secrets/cashmemo.env \
  -f infra/compose/docker-compose.yml up -d --build
just stack-health
```

Expected:

- exact Appwrite 1.9.6 digest, backend, web, suppression store, OTel Collector, OpenObserve healthy;
- TablesDB tables/columns/indexes from `data-model.md` available;
- direct unauthenticated/browser TablesDB access denied;
- contract suite confirms transactions, unique races, nested compound ordering, `ttl=0`, and
  normalized substring behavior;
- no command opens or queries internal MongoDB.

## Run application

```bash
just dev
```

Open URL printed by target. Sign-in UI is prerequisite outside Feature 001. US1 acceptance creates
isolated synthetic accounts and real sessions through supported Appwrite APIs, sends the opaque
session only as the protected `cashmemo_session` cookie, and deletes test accounts afterward. No
production route has a local-account fallback. Browser API responses must show
`Cache-Control: no-store`; service-worker cache inspector must contain static assets only.

## Validate User Story 1: create and durable retry

```bash
just acceptance us1-create
```

Expected:

- valid expense creates exactly one confirmed memo with exact values;
- zero/negative/excess precision/missing fields/prohibited patterns reject together and create
  nothing;
- server Pattern Set rejection is HTTP 422 `PRIVACY_INPUT_REJECTED`, may include only published
  safe detector ID, and exposes no candidate/normalized/match derivative;
- 1,000 same-ID retries, including after 30-day virtual clock and after edits, return one current
  memo/current lifecycle/current revision;
- same ID with any changed original field returns `CREATION_IDENTIFIER_CONFLICT`;
- different compose IDs with identical fields create two memos;
- fingerprint/wrapped-key inspection contains no readable amount/note.

## Validate User Story 2: list and view

```bash
just acceptance us2-list
```

Expected:

- default page 50, maximum 200, >200 rejected;
- exact descending instant/creation/ID order and stable tie-break;
- unchanged 10,000-row membership/order traverses exactly once with no duplicate or omission;
- every page returns `resultSetVersion`; every continuation supplies the same expected version and
  protected cursor binds it;
- create/archive/restore/delete/purge/occurrence edit, Recently Deleted deadline crossing, and
  current-query membership changes return `LIST_CHANGED`, discard page, and require visible refresh;
- membership-neutral non-sort edits preserve version/traversal; purged/expired rows never return;
- user A cannot observe user B through direct ID, broad/empty query, cursor, or response timing/body.

## Validate User Stories 3, 4, and 8: edit/archive/labels

```bash
just acceptance us3-edit us4-archive us8-labels
```

Expected:

- 1,000 two-writer cases: winner revision increments; loser gets current resource; no partial edit;
- failed/conflicting input remains in Dexie and supports re-apply/discard/merge;
- currency change never converts and asks confirmation every time;
- ordinary time edit keeps offset; explicit offset change keeps wall;
- archive/restore idempotent, field-preserving;
- case-fold duplicate blocked across active/deactivated labels;
- deactivated labels retained on memos/filters but absent from pickers;
- label delete refused for any lifecycle reference and race-safe at count zero.

## Validate User Stories 5 and 6: delete/search

```bash
just acceptance us5-delete us6-search
```

Expected:

- delete uses distinct confirmation, fixed 30-day deadline, Recently Deleted-only visibility;
- exact deadline makes memo unreachable on all paths with scheduler disabled;
- hourly virtual scheduler physically deletes within 24 hours; access fallback works independently;
- independent ledger contains exactly keyed `deletion_token`, `purged_at`, and
  `removal_not_before_at`; time alone never removes token;
- injected backup-destruction failure retains token, alerts, retries verification, and blocks
  cleanup until every resurrection-capable backup is proven destroyed;
- case/diacritic-insensitive note-only substring works from two characters, terms AND, filters AND;
- pending/expired and other-user rows never return;
- real 10,000-row search/filter p95 <1 second.

## Validate User Story 7: export

```bash
just acceptance us7-export
just export-schema-check
just export-concurrency --runs 100 --mutation-rate 100
```

Expected:

- default active only; explicit active+archived; never pending/expired;
- output validates `contracts/export-v1.schema.json`;
- exact 0/2/3/4-scale amounts round-trip; too few/many fractional digits fail schema validation;
- every instant uses canonical six-digit UTC `Z`; ±14:00 offsets pass and ±14:01..±14:59 fail;
- internal-field denylist finds zero fields;
- 10,000 memos complete with no truncation;
- each stress export equals fence-acceptance state; later writes block visibly and preserve drafts;
- injected read/memory/schema/lease failure delivers zero file bytes.

## Run quality and privacy gates

```bash
just format-check
just lint
just typecheck
just test-unit
just test-integration-real
just test-privacy-real
just acceptance-all
```

Expected: all pass in stated order. `test-privacy-real` scans browser/backend/Appwrite/proxy logs,
HTTP errors, captured OTLP, OpenObserve, crash reports, and artifacts for raw/escaped/encoded
canaries. Count must be zero for amounts, notes, label names, search terms, fingerprints/keys,
purge tokens, auth material, and export fragments.

## Validate backup retention and restoration

Read:

- `docs/operations/backup-retention.md`
- `docs/operations/backup-restore.md`

Run development single drill:

```bash
just backup-cold
just restore-drill-real --cycles 1
```

Pre-release qualification:

```bash
just restore-drill-real --cycles 100
```

Expected each cycle:

- real quiesced Appwrite backup restored into fresh isolated exact-version stack;
- current independent suppression ledger reapplied before any route exists;
- purged memo absent, expired restored pending memo deleted, retained data intact;
- missing ledger/key/corrupt manifest/incomplete scan refuses cutover;
- drill environment destroyed within 24 hours and original backup deadline;
- no direct MongoDB access and no mock-only success.

## Validate scheduler failure

```bash
just scheduler-test-real --disable-worker --advance 31d
```

Expected memo is inaccessible at deadline on every path. Then:

```bash
just scheduler-test-real --recover-worker
```

Expected physical purge, one suppression token, correct label counts, and zero other live
references. Test uses controllable clock; it does not wait 31 real days.

## Human usability acceptance

Product Research follows 20-user protocol in `test-strategy.md` with synthetic data. Required
evidence:

- median create under 30 seconds;
- at least 19/20 first-attempt success;
- median find among 2,000 memos under 15 seconds;
- no captured financial/search/form content.

Automated UI tests do not substitute for this study.

## Stop local stack

```bash
docker compose -f infra/compose/docker-compose.yml down
```

Do not add `-v` unless intentionally destroying local test data and secrets under separate,
explicit destructive procedure.
