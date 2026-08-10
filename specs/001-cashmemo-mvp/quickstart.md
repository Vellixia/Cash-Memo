# Quickstart Plan: Cashmemo MVP

This document defines the repeatable implementation-time bootstrap and verification experience. Commands refer to planned files/directories from `plan.md`; this planning run does not create or execute application code.

## Toolchain Baseline

- Node.js 24 LTS pinned by `.tool-versions` or equivalent;
- Corepack with a pinned pnpm release and frozen lockfile;
- Docker/Colima or Docker Desktop for PostgreSQL/Mailpit/local AWS-compatible fakes;
- OpenTofu pinned for infrastructure plans;
- AWS CLI v2 for controlled staging/production operations;
- Playwright-managed browser binaries;
- `git`, `jq`, `curl`, and `openssl`.

CI is the reproducibility authority. A developer bootstrap must work from a clean clone without manually editing generated files or using production credentials.

## Local Bootstrap Contract

Implementation should expose these commands:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm env:check
pnpm local:up
pnpm db:migrate
pnpm db:seed:synthetic
pnpm dev
```

Expected local services:

| Service | Local role | Data rule |
|---|---|---|
| PostgreSQL 18 | real relational constraints/RLS/migrations | synthetic data only; disposable volume |
| Mailpit | verification/reset delivery | local synthetic addresses only |
| local object adapter | export contract tests | no raw audio; disposable |
| fake STT/AI adapters | ordinary deterministic development | provider-port contract; cannot close real-provider evidence |
| OpenTelemetry collector | signal allowlist testing | local sink plus seeded-canary scanner |

The app starts at one HTTPS-capable local origin (development certificate) so cookies, recording permission, PWA manifest, and service worker boundaries resemble production. HTTP-only fallback may be allowed for unit work but cannot close PWA/auth acceptance.

## Configuration Contract

Planned `.env.example` lists names and safe descriptions only. No real value belongs in source. Required classes:

```text
APP_ENV, APP_ORIGIN, BUILD_VERSION
DATABASE_URL
AUTH_SESSION_SECRET, AUTH_TOKEN_HMAC_KEY, PASSWORD_PEPPER
EVIDENCE_HMAC_KEY, DELETION_SUPPRESSION_HMAC_KEY
AWS_REGION, EXPORT_BUCKET, EVIDENCE_BUCKET, DELETION_LEDGER_BUCKET
KMS_EXPORT_KEY_ARN, KMS_EVIDENCE_KEY_ARN
SES_FROM_ADDRESS
OPENAI_API_KEY, OPENAI_PROJECT_ID, OPENAI_BASE_URL
STT_MODEL_SNAPSHOT, EXTRACTION_MODEL_SNAPSHOT
PROVIDER_DECISION_VERSION, CURRENCY_REGISTRY_VERSION
OTEL_EXPORTER_OTLP_ENDPOINT
```

Local secrets are generated into an ignored developer file by `pnpm env:init:local`; CI/staging/production secrets come from protected stores. `pnpm env:check` validates presence and format without printing values.

## Development Modes

```bash
pnpm dev:manual          # core app; STT/AI forced unavailable
pnpm dev:fake-providers  # deterministic contract fakes
pnpm dev:real-providers  # explicit protected sandbox credentials and consent banner
```

`dev:manual` is a first-class mode and must support auth (local email), onboarding, structured capture, memo lifecycle, labels, search, reporting, export, and deletion. Provider absence cannot prevent server startup or core health.

## Database Workflow

```bash
pnpm db:generate         # generate reviewed SQL from declared schema
pnpm db:migrate          # apply committed migrations
pnpm db:verify           # constraints, RLS, registry, migration checksum
pnpm db:reset:local      # local disposable database only; guarded by APP_ENV=local
```

Production never runs ORM schema push. Accepted `0001_cashmemo_mvp.sql` and `0002_roles_rls.sql` remain immutable. `0003_better_auth_compat.sql` forward-migrates identity tables; `0004_identity_access_boundary.sql` introduces the dedicated `cashmemo_identity` role and revokes `cashmemo_runtime` access to Better Auth core tables; later search work uses `0005_search_projection.sql`. Migration CI proves both empty `0001 → 0002 → 0003 → 0004` and representative accepted pre-0003 data `0001 → 0002`, synthetic rows, then `0003 → 0004`, followed by RLS/constraint and safe-forward verification. Outstanding pre-0003 verification actions are intentionally invalidated and must be requested again.

Synthetic seeding creates two isolated accounts, starter labels, valid multi-currency/timezone memos, archived/deleted/draft states, and fixed report golden data. Seed commands reject non-local/staging environments unless a dedicated synthetic marker is present.

## Required Verification Commands

Implementation should make the constitutional order visible:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:property
pnpm test:contract
pnpm test:integration
pnpm test:auth:better-auth-compat
pnpm test:privacy
pnpm test:security
pnpm test:acceptance
pnpm test:providers:real
pnpm test:performance
pnpm test:operations
pnpm evidence:verify
```

`pnpm verify` invokes these in blocking order and stops at the first failed mandatory gate. Provider/operational suites require the explicit protected environment and never silently downgrade to fakes.

## Local Product Walkthrough

After `pnpm dev:fake-providers`:

1. Sign up using the controlled local inbox and follow the expiring verification link; replay must not create a second verification transition.
2. Log in; close/reopen the installed PWA and verify the session restores.
3. Complete privacy onboarding and select default currency, locale, and reporting timezone.
4. Create and explicitly confirm a structured manual expense.
5. Enter a synthetic natural-language money event, review uncertainty, edit every field, and confirm.
6. Record a short synthetic voice event; verify countdown, transcript, draft, edit, and explicit confirmation.
7. Traverse at least two unchanged history pages and verify stable keyset order. Start another traversal, change an occurrence/lifecycle/filterable field in another tab, and verify its old continuation returns `RESULTS_CHANGED` with no page; refresh and complete a new traversal.
8. Edit using one tab while saving a stale revision in another; verify the second write conflicts and local text remains.
9. Archive/restore, move to Recently Deleted/restore, and request immediate purge with reauthentication.
10. Create labels, search/filter, and verify overview/review sections remain separated by currency.
11. Export JSON/CSV, validate the manifest, and cancel/delete the package.
12. Force STT/AI unavailable and repeat structured manual operations.
13. Request account deletion, verify suspended grace behavior, then cancel.

This walkthrough is developer orientation, not release evidence.

## Real-Provider Sandbox

Real-provider runs require:

- approved sandbox project/region and versioned provider decision;
- synthetic corpus approved by privacy owner;
- outbound capture proxy that proves allowlisted payload shape without storing content;
- OpenAI ZDR/no-training administrative evidence;
- exact model snapshots from the plan;
- AWS SES controlled inbox/domain;
- teardown/retention check after the run.

The command aborts before sending content if approval/config versions do not match. It never falls back to a default OpenAI project.

## Authentication Compatibility Verification

`pnpm test:auth:better-auth-compat` runs Better Auth 1.6.26 against real PostgreSQL after committed migrations 0001/0002/0003. It must prove supported plural/snake-case mappings need zero additional migration; boolean `email_verified` is the only verification authority; fixed server-side `name` works without product name input; credential flows leave OAuth-only fields null; email verification is not persisted and replay/expiry cannot perform a transition; `verification.storeIdentifier="hashed"` prevents raw reset-token persistence; core `value` behavior is explicitly asserted; consumed/expired reset rows are deleted; logs/evidence contain no token; Better Auth stores and queries its supported core session `token` directly with no Cashmemo hashing/lookup adapter; cookie cache, secondary storage, and stateless mode are disabled; `expiresIn=7d`/`updateAge=1h` refresh behaves as documented; middleware revokes at `createdAt+30d`; and password reset and current/other/all revocation use supported Better Auth APIs. Separate ten-minute `ReauthGrant` behavior remains Cashmemo-owned and is proven by T051/T054 without mutating or replacing Better Auth session lifecycle. Schema/query snapshots contain no token value.

## Deletion/Restore Verification

`pnpm test:operations` must create synthetic individual memo and account purges, verify durable `money_memo`/`account` deletion tokens before hard deletion, restore a pre-purge backup in isolation, and prove exact suppression. It then advances beyond `removal_not_before_at` and exercises every cleanup blocker: open automated recovery window, prohibited/manual/final/copied/replicated snapshot detection, AWS Backup recovery point, active isolated restore copy, and unavailable inventory. Each blocker must retain token/key version, alert, and retry. Only a clean full-lineage inventory may remove the token. No S3 lifecycle expiration is accepted as evidence.

## PWA Verification

```bash
pnpm build
pnpm preview:https
pnpm test:pwa
```

Verify installability, offline shell, update prompt, IndexedDB draft recovery, and explicit offline/degraded states. Inspect Cache Storage and assert no `/api`, auth, audio, export, diagnostic, or user-specific response exists. General offline mutation synchronization is not implemented.

## Evidence Safety

Test commands write content-safe results to `ops/evidence/` only through a typed evidence writer. The writer:

- permits only the manifest fields in `test-strategy.md`;
- rejects free-form attachments by default;
- scans output for synthetic canaries, email/audio/transcript/money fixtures, secrets, URLs with queries, and detector material;
- quarantines and fails any suspect artifact;
- records hashes and protected external artifact references, never payloads.

## Environment Promotion

```text
clean CI build → integration/privacy/security gates
→ deploy immutable digest to staging
→ migration verify → real-provider/browser/performance/operations evidence
→ mandatory hook/analyze review → role approvals
→ production migration task → ECS deployment circuit breaker
→ synthetic core/provider smoke → promote or rollback/safe-forward
```

Production promotion uses the same image digest tested in staging. Feature flags may disable STT/AI independently; no flag bypasses confirmation, privacy checks, RLS, deletion, or evidence gates.

## Destructive Command Safety

Local reset and staging teardown commands must:

- require exact environment identity and a typed confirmation;
- reject production account IDs/regions;
- print resolved resource identifiers but no secret/content;
- avoid broad paths, globs, or unresolved variables;
- produce a content-free operation record.

Production purge/restore is run only through reviewed runbooks with two-role approval where infrastructure permits.
