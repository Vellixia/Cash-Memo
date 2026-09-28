# Cash Memo

**Your private money journal.** Jot down money in and out in any currency, say what paid for it, and see where each month went at a glance. There are no bank connections, no ads and no data selling.

Live: **https://cashmemo.andresholivin.dev**

- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [API](#api)
- [Data model](#data-model)
- [Money & currency rules](#money--currency-rules)
- [CSV export & import](#csv-export--import)
- [Security & privacy](#security--privacy)
- [PWA & offline](#pwa--offline)
- [Testing](#testing)
- [CI/CD & deployment](#cicd--deployment)
- [Operations](#operations)
- [Roadmap](#roadmap)

---

## Features

- **Memos**: income, expense or transfer, with amount, currency, date and time, an optional category and note. Create, edit and delete from a bottom sheet on phones or a dialog on larger screens.
- **Sources**: name what money moves through (BCA, Cash, GoPay, a Visa card, a paylater account…), each with a kind (cash, bank, e-wallet, credit, paylater, other) and an emoji.
  - Every expense says what paid for it. Income can say where it landed.
  - **Balance tracking is optional per source.** Turn it on to give the source a currency and an opening balance. Credit cards and paylater show what you **owe**.
  - **Transfers** move money between two sources (bank → GoPay top-up, bank → credit card bill). They never count as income or expense, so paying a card bill doesn't count the spending twice.
  - Every account starts with a "Cash" source. Archived sources stay on old memos.
- **Any currency, shown the way it's written there**: `Rp 7.500.000`, `$7,500.00`, `7.500,00 €`, `¥7,500`. The amount input follows the same separators and decimals.
- **Default currency**: set per account. It's guessed from your region at sign-up and can be changed in Settings.
- **Month at a glance**: net for the month, an income-vs-expense bar, a spending-by-category donut, a card per currency when you use several, balances of tracked sources, and a ledger grouped by day with income/expense, category and source filters.
- **Recurring memos**: repeat any memo weekly, monthly or yearly (the 31st clamps to month end). Upcoming ones show in the ledger, and the worker creates each one when it's due. Pause, edit or stop them on the Recurring page.
- **Budgets**: a monthly limit per expense category and currency, with progress on Home (recurring memos still to come are shown as projected) and a nudge at 80% and 100%.
- **Search** across every month: notes, categories and sources, from the top bar, the Home header or `/`.
- **Keyboard shortcuts** on desktop: `n` new memo, `←`/`→` previous/next month, `/` search.
- **Undo**: deleting a memo or archiving a source shows a short-lived Undo.
- **Receipts**: attach one photo per memo, from the camera or a file. It's downscaled and re-encoded in the browser (which also strips EXIF) and stored privately.
- **Credit & paylater**: credit limit, statement and due days on a card; buy in 3/6/12 (or any 2–36) installments with an optional fee; owed vs limit and due reminders on Home.
- **Reports**: a separate page with income vs expense per month, spending by top categories over time, and this month vs last per category (6 or 12 months).
- **Emoji categories**: separate lists for income and expense, with a one-click starter set on first run and rename/emoji/delete on the Categories page.
- **Appearance**: light, dark or system theme, six accent palettes that tint the whole app (background, cards, borders, controls; income/expense colors stay fixed), six font pairs (Classic, Modern, Readable, System, Rounded, Mono) with live previews, and a larger text size. Saved on the account so it follows you across devices, and applied before first paint.
- **Settings vs Account**: Settings holds appearance, default currency, categories, recurring memos and your data. Account holds identity and security.
- **Account**: password reset by email, change password (other devices are signed out), change email (confirmed from the new address), delete the account and everything in it.
- **Your data**: export everything as CSV, and import CSV from another app or your bank, with a preview before anything is saved.
- **Works everywhere**: responsive from 320px phones to wide desktops.
  - Bottom tabs on phones (Home · Reports · **+** · Sources · Settings), a top bar from tablet size up.
  - A two-column dashboard on desktop.
- **Installable & offline-readable (PWA)**:
  - Install it like an app. The install entry is offered quietly in the account menu and on the Account page, never as a popup.
  - Screens you've already opened still work offline.
- **Private by default**: see [Security & privacy](#security--privacy).

## Tech stack

| Layer | Choice |
|---|---|
| Monorepo | [Turborepo](https://turborepo.com) + Bun workspaces (JS), Cargo workspace (Rust) |
| API | Rust, [Axum 0.8](https://github.com/tokio-rs/axum), [SeaORM 2](https://www.sea-ql.org/SeaORM/) (sqlx/Postgres), argon2id (`password-auth`) |
| Worker | Rust + Tokio: background jobs from a Postgres queue (email, CSV export/import, file cleanup); `csv`, `reqwest`, `rusty-s3` (presigned URLs) |
| Database | PostgreSQL 18 |
| Object storage | Cloudflare R2 in production; [RustFS](https://github.com/rustfs/rustfs) (S3-compatible) locally and in CI |
| Email | [Resend](https://resend.com) (transactional only) |
| Errors, logs, uptime | Self-hosted [GlitchTip](https://glitchtip.com) via the Sentry SDKs (`sentry` crate, `@sentry/nextjs`) |
| Frontend | [Next.js 16](https://nextjs.org) (App Router) on [Bun](https://bun.sh), React 19, TypeScript |
| UI | Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com) on Base UI, lucide icons, Fraunces, Geist, Geist Mono and Atkinson Hyperlegible fonts |
| State & data | TanStack Query (server state), zustand (UI state), react-hook-form + zod (forms) |
| Testing | `cargo test` (API, queue and CSV round trip against real Postgres + S3), `bun test` (money, CSV preview parser), Playwright (e2e, 4 viewports) |
| Delivery | GitHub Actions → GHCR images → [Dokploy](https://dokploy.com), auto-deployed after green CI |

## Architecture

```
 Browser / installed PWA
   │  same origin: cashmemo.andresholivin.dev                     ┌──────────────────────┐
   ▼                                                              │ Cloudflare R2        │
 ┌──────────────────────────────┐    presigned PUT/GET (CSV) ────▶│ cashmemo-files       │
 │  web  (Next.js on Bun)       │                                 │ (1-day on users/)    │
 │  /api/* ── runtime proxy ────┼──┐                              └──────────▲───────────┘
 └──────────────────────────────┘  │ cookie, body, client IP                 │
                                   ▼                                         │ export upload,
                    ┌──────────────────────────┐                             │ import download
                    │  api  (Rust / Axum)      │ auth, memos, sources,       │
                    │  internal only, :8080    │ summary, queues jobs        │
                    └────────────┬─────────────┘                             │
                                 ▼                                           │
                         PostgreSQL 18  ◀── jobs table ──┐                   │
                                 ▲                       │                   │
                    ┌────────────┴─────────────┐         │                   │
                    │  worker  (Rust / Tokio)  │─────────┘───────────────────┘
                    │  2 DB connections max    │──── email ────▶ Resend
                    └──────────────────────────┘
   api, worker, web ── errors + logs ──▶ GlitchTip (self-hosted, shared "Observability & Mgmt")
   GitHub Actions (every 15 min) ── GET /api/health ──▶ off-host watchdog
   Dokploy ── daily pg backup ──▶ R2 dokploy-backups
```

- **One origin.** The browser only ever talks to the Next app. Its `/api/[...path]` route handler proxies to the API at runtime (`API_URL`), so session cookies are first-party and there's no CORS. The one exception is CSV files: the browser uploads and downloads them **directly** to R2 with short-lived presigned URLs, so file bytes never pass through web or API memory.
- **Sessions** are opaque random tokens in an `HttpOnly; SameSite=Lax` cookie (plus `Secure` in production). Only the token's SHA-256 is stored.
- **Auth gate.** `proxy.ts` (Next middleware) shows the landing page at `/` to signed-out visitors and sends other app routes to `/login` when there's no session cookie. The API is the real authority: every query is scoped to the session's user.
- **API vs worker.** The API answers requests and never does heavy or slow work. Anything that talks to a third party (email) or touches many rows (CSV) becomes a row in the `jobs` table. The worker claims jobs with `FOR UPDATE SKIP LOCKED`, runs them one at a time per loop on its own 2-connection pool, and retries failures with backoff (30 s, 2 min, 8 min…).
- **Migrations** are owned by the API (run on boot). The worker waits until they exist.

## Repository layout

Rule of thumb: **each deployable service is its own `apps/<name>`; code that more than one service needs lives in `crates/`.** A new service (a scheduler, a webhook receiver…) gets a new app instead of growing `api` or `web`.

```
apps/
  api/                    HTTP API (crate `api`)
    src/main.rs           startup: telemetry, DB pool, migrations, storage, graceful shutdown
    src/lib.rs            router, AppState, /health, shared validators
    src/auth.rs           signup / login / logout / me, session extractor, auth rate limits
    src/account.rs        password reset, change password/email, delete account
    src/memos.rs          memos CRUD (income/expense/transfer rules) + monthly summary
    src/sources.rs        sources CRUD, balances, archive
    src/categories.rs     categories CRUD (emoji)
    src/data.rs           CSV export/import endpoints, job status
    src/limits.rs         in-memory rate limiter
    src/error.rs          AppError → { "error": "..." } + JSON-shaped extractors
    tests/api.rs          end-to-end API tests against real Postgres
    Dockerfile
  worker/                 background jobs (crate `worker`)
    src/main.rs           startup, loops, graceful shutdown
    src/email.rs          Resend sender: throttle, daily cap, retries
    src/data.rs           CSV export, import preview/commit, file purge
    tests/csv.rs          50k-row export → import round trip (Postgres + S3)
    Dockerfile
  web/                    Next.js app (package `web`)
    app/                  routes: (app)/ home, categories, sources, account (+ import) · login · signup ·
                          forgot · reset · confirm-email · welcome (landing) · offline
    app/api/[...path]/    runtime proxy to the API
    components/           app shell, summary, ledger, memo editor, appearance, landing, pwa …
    components/ui/        shadcn components (Base UI)
    lib/                  api client, money/currency helpers, CSV preview parser, appearance, queries, store
    public/sw.js          service worker
    e2e/                  Playwright specs
    Dockerfile
crates/
  domain/                 SeaORM entities + migrations, job queue, money exponents, CSV row rules,
                          storage presigning; tests/jobs.rs (queue against Postgres)
  telemetry/              tracing + GlitchTip (Sentry) setup with PII scrubbing
docker-compose.yml        local Postgres + RustFS (S3)
turbo.json · package.json · Cargo.toml
```

## Getting started

Prerequisites: [Bun](https://bun.sh) ≥ 1.4, Rust (stable), Docker (for Postgres and S3).

```sh
cp .env.example .env
docker compose up -d           # Postgres, RustFS (S3) and its bucket
bun install
bun run dev                    # api on :8080, worker, web on :3000
```

Open http://localhost:3000, create an account, and add the starter categories. Without `RESEND_API_KEY`, the worker prints emails (reset and confirm links) to its log instead of sending them.

## Configuration

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | api, worker | — (required) | `postgres://user:pass@host:5432/db` |
| `PORT` | api / web | `8080` / `3000` | |
| `COOKIE_SECURE` | api | `false` | set `true` behind HTTPS |
| `APP_URL` | api | `http://localhost:3000` | public web URL, used in email links |
| `RUST_LOG` | api, worker | `info,sqlx=warn` | tracing filter |
| `SENTRY_DSN` | api, worker | unset | GlitchTip DSN; unset = stdout only |
| `SENTRY_ENVIRONMENT` | api, worker | `production`/`development` | |
| `S3_ENDPOINT` | api, worker | unset | e.g. `https://<account>.r2.cloudflarestorage.com`; unset disables CSV export/import |
| `S3_BUCKET` | api, worker | unset | `cashmemo-files` |
| `S3_REGION` | api, worker | `auto` | R2 uses `auto` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | api, worker | unset | R2 API token with object read/write on the bucket |
| `RESEND_API_KEY` | worker | unset | unset = log emails instead of sending |
| `MAIL_FROM` | worker | — (required with Resend) | e.g. `Cash Memo <noreply@mail.cashmemo.andresholivin.dev>` |
| `EMAIL_DAILY_CAP` | worker | `90` | stays under Resend's free 100/day; extra mail waits an hour |
| `API_URL` | web | `http://localhost:8080` | where the web proxy forwards `/api/*` (read at runtime) |
| `NEXT_PUBLIC_SENTRY_DSN` | web (build time) | unset | GlitchTip DSN for browser/server errors; unset = off. Inlined when the image is built, so set it as the GitHub **variable** `NEXT_PUBLIC_SENTRY_DSN` (`images.yml` passes it as a build arg) |

The Rust apps load `.env` from the repo root in development (`dotenvy`).

## Scripts

From the repo root (Turborepo runs every app):

| Command | What it does |
|---|---|
| `bun run dev` | API (`cargo run`), worker (`cargo run -p worker`) and web (`next dev`) |
| `bun run build` | release API build + Next production build |
| `bun run test` | all Rust tests (need the local DB and S3) |
| `bun run lint` | `cargo fmt --check` + `clippy -D warnings` (whole workspace) + ESLint |

In `apps/web`:

| Command | What it does |
|---|---|
| `bun test lib` | money/currency and CSV preview unit tests |
| `bun run test:e2e` | Playwright against a running app (`BASE_URL`, default `http://localhost:3000`) |
| `bun run screenshots` | renders review screenshots of every screen into `e2e/screenshots/` |

## API

All routes are under `/api` and use JSON. Errors are always `{ "error": string }` with a matching status code (400, 401, 404, 409, 429, 500 or 503). Authenticated routes need the `session` cookie.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | | 200 if the DB is reachable, else 503 |
| POST | `/auth/signup` | `{ email, password (8–256), default_currency? }` | `User` + cookie · 409 if the email is taken · 429 (5 per 10 min per IP) |
| POST | `/auth/login` | `{ email, password }` | `User` + cookie · 401 · 429 (10/min per IP, 20 per 15 min per email) |
| POST | `/auth/logout` | | 204, clears the cookie |
| GET / PATCH | `/auth/me` | PATCH `{ default_currency?, preferences? }` (`preferences` is a partial merge of `{ theme, accent, font, size }`, validated) | `User` |
| POST | `/auth/password-reset/request` | `{ email }` | always 204; a 1-hour single-use link is emailed if the account exists |
| POST | `/auth/password-reset/complete` | `{ token, password }` | 204, signs out every session · 400 invalid/expired |
| POST | `/auth/password` | `{ current_password, new_password }` | 204, signs out other sessions |
| POST | `/auth/email` | `{ current_password, new_email }` | 204, emails a confirm link to the new address · 409 · 429 |
| POST | `/auth/email/confirm` | `{ token }` | `User` with the new email |
| POST | `/auth/delete` | `{ password }` | 204, hard-deletes the account and its files, clears the cookie |
| GET | `/memos` | `?month=YYYY-MM&offset=<min east of UTC>[&category_id=][&source_id=]` | `Memo[]`, newest first (`source_id` matches either side of a transfer) |
| POST | `/memos` | `{ direction, amount_minor>0, currency, occurred_at, category_id?, source_id?, to_source_id?, note? }` | 201 `Memo` |
| GET / PATCH / DELETE | `/memos/:id` | PATCH takes any subset; `null` clears `category_id` / `source_id` / `note` | `Memo` / 204 (soft delete) |
| POST | `/memos/:id/restore` | | `Memo`, undoes a soft delete (404 if not deleted) |
| GET | `/search` | `?q=` (≥ 2 chars) `[&before=<occurred_at>,<id>][&limit≤100]` | `Memo[]` matching note, category or source, newest first, keyset paged |
| POST | `/memos/:id/attachment` | `{ content_type: image/jpeg \| image/webp }` | `{ upload_url, key }`: PUT the image there (5 min) |
| PUT / GET / DELETE | `/memos/:id/attachment` | PUT `{ key }` confirms (≤ 5 MB, replaces the old one) | `{ has_attachment }` / `{ url }` (5 min) / 204 |
| GET / POST | `/recurring` | POST `{ memo_id, cadence, offset_minutes }` or memo fields + `{ next_date, cadence, offset_minutes }` | rules / 201 (anything already due is created at once) |
| PATCH / DELETE | `/recurring/:id` | PATCH any memo field, `cadence`, `next_date`, `paused` | rule / 204 (stops it; memos it created stay) |
| GET | `/recurring/upcoming` | `?month=YYYY-MM&offset=` | occurrences still to come this month |
| GET / POST | `/budgets` | GET `?month=&offset=` · POST `{ category_id, currency, limit_minor }` | budgets with `spent_minor`, `projected_minor` / 201 · 409 duplicate |
| PATCH / DELETE | `/budgets/:id` | `{ limit_minor }` | budget / 204 |
| GET / POST | `/installments` | POST `{ source_id, currency, principal_minor, fee_minor?, months (2–36), first_date, offset, category_id?, note? }` | plans with paid/remaining counts / 201, creates every installment memo |
| DELETE | `/installments/:id` | | 204, removes the plan and its future installments (past ones stay) |
| GET | `/reports/trend` | `?months=6\|12&offset=` | `{ months[], totals[], by_category[] }` per local month; transfers excluded |
| GET | `/sources` | | `Source[]` (archived included) |
| POST | `/sources` | `{ name, kind, emoji?, track_balance?, currency?, opening_minor? }` | 201 `Source` · 409 on a duplicate name |
| PATCH | `/sources/:id` | `{ name?, kind?, emoji?, track_balance?, currency?, opening_minor?, archived?, credit_limit_minor?, statement_day?, due_day? }` (the last three only for credit/paylater) | `Source` |
| DELETE | `/sources/:id` | | 204, archives it (400 for the last active source) |
| GET | `/categories` | | `Category[]` |
| POST | `/categories` | `{ name, direction, emoji? }` | 201 `Category` · 409 on a duplicate |
| PATCH | `/categories/:id` | `{ name?, emoji? }` (`emoji: null` clears it) | `Category` |
| DELETE | `/categories/:id` | | 204. Its memos keep existing, uncategorized |
| GET | `/summary` | `?month=YYYY-MM&offset=` | `{ month, totals[], by_category[] }`, per currency and direction; transfers excluded |
| POST | `/exports` | `{ offset }` | 202 `{ job_id }` · 409 one at a time · 429 (5/day) · 503 without storage |
| POST | `/imports` | | `{ import_id, upload_url }`: PUT the CSV file to `upload_url` (15 min) |
| POST | `/imports/:import_id/validate` | `{ mapping }` | 202 `{ job_id }` (the preview) |
| POST | `/imports/:preview_job_id/commit` | | 202 `{ job_id }` · 400 preview not ready · 409 already imported |
| GET | `/jobs/:id` | | `{ id, kind, status, result, error, download_url? }` |

```ts
type User     = { id: string; email: string; default_currency: string;
                  preferences: { theme?; accent?; font?; size? } };
type Memo     = { id; direction: "income" | "expense" | "transfer"; amount_minor: number; currency: string;
                  occurred_at: string; category_id: string | null; source_id: string | null;
                  to_source_id: string | null; note: string | null; has_attachment: boolean;
                  created_at: string; updated_at: string };
type Source   = { id; name: string; kind: "cash" | "bank" | "ewallet" | "credit" | "paylater" | "other";
                  emoji: string | null; track_balance: boolean; currency: string | null;
                  opening_minor: number; archived_at: string | null; balance_minor: number | null;
                  credit_limit_minor: number | null; statement_day: number | null; due_day: number | null };
type Category = { id: string; name: string; direction: "income" | "expense"; emoji: string | null };
```

Memo rules, checked on the final state of every create or update:

- An **expense needs a source**. Legacy memos from before sources stay valid ("Unspecified") until their direction or source is changed.
- A **transfer** needs two different sources and has no category.
- If a source has a **currency lock** (balance tracking on), its memos must use that currency.
- **Archived** sources can't be newly picked.

`offset` makes month boundaries follow the viewer's local time. For example, a memo at 03:00 on 1 October in Jakarta (UTC+7) belongs to October, even though it is still 30 September in UTC.

## Data model

| Table | Key columns |
|---|---|
| `users` | `id uuid`, `email` (unique, lowercase), `password_hash` (argon2id), `default_currency char(3)`, `preferences jsonb` (appearance), `created_at` |
| `sessions` | `token_hash bytea` (sha256 of the cookie token), `user_id` → users (cascade), `expires_at` (30 days) |
| `categories` | `id`, `user_id`, `name` (1–100), `direction` (income/expense), `emoji` (≤ 8 chars), unique `(user_id, name, direction)` |
| `sources` | `id`, `user_id`, `name` (1–100, unique per user), `kind`, `emoji`, `track_balance`, `currency` (required when tracking), `opening_minor`, `archived_at`, `credit_limit_minor`, `statement_day`, `due_day` |
| `memos` | `id`, `user_id`, `direction` (income/expense/transfer), `amount_minor bigint > 0`, `currency char(3)`, `occurred_at timestamptz`, `category_id` (set null on delete), `source_id`, `to_source_id` (CHECK: a transfer has both, different, and no category), `note`, `recurring_rule_id` (unique with `occurred_at`, so creation is idempotent), `installment_plan_id`, `attachment_key` (never returned), `deleted_at` (soft delete), timestamps, index `(user_id, occurred_at desc, id desc)`, trigram index on `note` for search |
| `recurring_rules` | `id`, `user_id`, memo fields, `cadence` (weekly/monthly/yearly), `anchor_day`, `next_date`, `offset_minutes`, `paused_at` |
| `budgets` | `id`, `user_id`, `category_id` (cascade), `currency`, `limit_minor > 0`, unique `(category_id, currency)` |
| `installment_plans` | `id`, `user_id`, `source_id` (credit/paylater), `category_id`, `note`, `currency`, `principal_minor`, `fee_minor`, `months`, `first_date` |
| `jobs` | `id`, `kind`, `payload jsonb`, `status` (queued/running/done/failed), `attempts`, `run_after`, `locked_at`, `error`, `result jsonb`, `user_id` (cascade) |
| `email_tokens` | `token_hash` (sha256), `user_id`, `purpose` (reset/change_email), `new_email`, `expires_at` (1 h), `used_at` |
| `import_rows` | unlogged staging for import previews: parsed rows keyed by `import_id`, swept after a day |

Balance of a tracked source = `opening_minor` + income − expense − transfers out + transfers in, counting memos dated up to now (future installments don't count yet). Credit and paylater sources usually sit below zero, which the app shows as "Owed".

Migrations live in `crates/domain/src/migration` and run automatically when the API starts.

## Money & currency rules

- **Amounts are integers in minor units** (`amount_minor`), paired with an ISO 4217 code. There are no floats anywhere.
- **The minor-unit exponent is fixed per currency** (for example USD 2, IDR 0, JPY 0, KWD 3). It comes from `Intl` in the fixed `en` locale, with the ~17 currencies where browser engines disagree pinned in `lib/money.ts`, so a stored amount means the same thing in every browser. `crates/domain/src/money.rs` carries the same table for CSV.
- **Display uses the currency's home format** (IDR in `id-ID`, EUR in `de-DE`, INR in `en-IN` …). Display never changes the stored value.
- **No conversion.** Totals are always per currency, and a transfer moves one currency between two sources. Converted totals are on the [roadmap](#roadmap).
- **Transfers are neither income nor expense.** They change source balances but never the monthly summary.

## CSV export & import

The design goal is that **no file, however large, can slow the database down for everyone else**.

- **Export** (Settings → Your data):
  1. The API queues a job and returns immediately.
  2. The worker reads the user's memos in **keyset pages of 1,000** (`(occurred_at, id) < last`, using the index). Each page is a short query with a 30 s statement timeout and a 50 ms pause after it, so there's no long transaction and memory stays flat.
  3. Rows stream into a temp file (UTF-8 with BOM for spreadsheets; cells starting with `= + - @` are neutralized), which is uploaded to R2.
  4. The page polls the job and gets a 1-hour download link.
  5. Columns are `date` (ISO 8601 with your offset), `direction`, `amount` (decimal), `currency`, `category`, `source`, `to_source`, `note`.
  6. 50k memos export in about 4 seconds.
- **Import** (Settings → Import from CSV):
  1. The browser reads the first rows locally to propose a column mapping (our own export columns and common bank headers are recognized).
  2. The browser uploads the file straight to R2 (≤ 50 MB, ≤ 200k rows).
  3. **Preview**: the worker streams the file to disk, parses it on a blocking thread, and validates each row with the same rules as the API:
     - Amounts may be signed or bank-style (`1.234,56`, `(12.00)`).
     - Directions can be income/expense/transfer or debit/credit words.
     - Dates can be ISO, day/month/year or month/day/year.
     - Tracked sources must match their currency.
  4. Valid rows are staged in an unlogged table in batches, using one `unnest` insert per 1,000 rows. You get a report of valid rows, row errors with line numbers, duplicates that will be skipped, and the categories/sources that will be created.
  5. **Commit** inserts exactly the previewed rows in one transaction, creating missing categories and sources and skipping duplicates (same time, direction, amount, currency and note). A preview can only be committed once.
- **Guards**:
  - one export and one import per user at a time;
  - 5 exports and 20 previews per day;
  - the worker has at most **2 DB connections** and runs one data job at a time;
  - jobs retry 3 times and then report to GlitchTip.
- **Storage**: private bucket `cashmemo-files`, CSV keys under `users/<id>/`, with a **1-day lifecycle rule limited to the `users/` prefix** so they delete themselves. Receipt photos live under `attachments/<id>/` and are kept. Deleting an account sweeps both prefixes.
- **R2 CORS** (needed because the browser PUTs/GETs directly): allow origin `https://cashmemo.andresholivin.dev`, methods `GET, PUT`, header `content-type` (CSV and `image/jpeg`/`image/webp` uploads sign it).

## Security & privacy

- **Passwords:** hashed with argon2id, off the async runtime. Login takes the same time whether or not the email exists.
- **Sessions:** random 32-byte tokens stored hashed. The cookie is `HttpOnly`, `SameSite=Lax` and `Secure`. Expired sessions are swept on login. A password reset signs out every session; a password change signs out the others.
- **Email links:** random 32-byte tokens, stored hashed, single-use, valid for 1 hour. Reset requests always answer 204, so they don't reveal whether an account exists.
  - Mail is limited to 1 per minute and 5 per day per account, plus a global daily cap.
  - Once sent, an email job's payload is wiped so live links don't linger in the database.
- **Rate limits:** login, sign-up, reset requests and current-password checks are limited per IP and per account. The web proxy forwards the client IP (`CF-Connecting-IP`).
  - The limiter lives in memory, so limits are per API instance (fine for one replica).
- **Per-user data:** every data query is filtered by the session's user id. Another user's id returns 404. Import keys are derived server-side, so a client can't point the worker at someone else's file.
- **Validation:** every input is validated server-side (direction, positive amounts, currency shape, category/source ownership, direction match, transfer and currency-lock rules). Database `CHECK` constraints are a second guard.
- **Offline cache:** the service worker wipes its cache of API data on login, sign-up, logout and account deletion, so a shared device never shows the previous user's data.
- **Third parties:**
  - No bank connections, no analytics, no ads.
  - Transactional email is sent through Resend: only the address and the message.
  - Errors and logs go to our own self-hosted GlitchTip, with request bodies, query strings, cookies and headers stripped, so no amounts or notes are sent.
  - CSV files sit in a private R2 bucket for at most a day.

## PWA & offline

- `app/manifest.ts`: standalone display, 192/512 and maskable icons, shortcuts (Categories, Account).
- `public/sw.js`:
  - **Hashed static assets:** cache-first.
  - **Pages and API reads:** network-first, with the cached copy used offline.
  - **Unvisited pages:** `/offline` when there's no cached copy.
  - **Writes:** always go to the network. The UI disables saving while offline and shows an offline banner.
- **Updates:** a "new version is ready → Reload" toast. The first install never reloads the page.
- **Install:** `lib/install.ts` (`useInstall`) captures the browser's install prompt, which is offered from the account menu and the Account page. iOS gets "Share → Add to Home Screen" instructions.

## Testing

- **API** (`apps/api/tests/api.rs`, real Postgres) covers:
  - auth and memos across currencies, local-time month boundaries, partial updates, category/direction rules, per-category summary, the error shape and user isolation;
  - sources, balances and "owed", the currency lock, transfers excluded from the summary, and archiving;
  - rate limits (429);
  - reset, change-password and change-email flows through the queued email;
  - account deletion;
  - export/import endpoint guards.
- **Queue** (`crates/domain/tests/jobs.rs`): two workers racing for one job (exactly one wins), retry with backoff, payload scrubbing.
- **CSV** (`apps/worker/tests/csv.rs`, Postgres + S3):
  - exports 50k memos (with formula-looking and multi-line notes plus a transfer) and imports them into a new account, with totals, notes and transfer preserved;
  - a second import skips all 50k as duplicates, and a preview can't be committed twice;
  - bad rows are reported by line;
  - account files are purged.
- **Unit:** `cargo test -p domain --lib` (money parsing, CSV row rules), `bun test lib` (money formatting, CSV preview parser).
- **E2E:** Playwright across `desktop` 1280, `mobile` 390, `tablet` 820 and `wide` 1440.
  - Covers every user-facing flow: auth, password reset, change password/email, delete account, account menu, theme and appearance, month switching, memo add/edit/delete/validation, sources and transfers, filters, currencies, categories, export/import, landing, responsive layout at each breakpoint, a centered add button on phones, no horizontal overflow at 320px, and PWA manifest/offline/cache wipe.
  - Each test gets its own client IP, so the auth rate limits don't interfere.
  - Any console error or page error fails a test.

```sh
docker compose up -d
cargo build --release -p api -p worker && ./target/release/api & ./target/release/worker &
cd apps/web && bun run build && PORT=3000 bun run start &
bun run test:e2e
```

## CI/CD & deployment

- **`ci.yml`** (push to `main`, PRs), with Postgres and RustFS (S3) as services:
  - `check` job: lint, all Rust tests and build.
  - `e2e` job: release API + worker, then the web production build, then Playwright on all viewports.
- **`images.yml`** runs only after `ci` passes on a push to `main`:
  - builds `ghcr.io/vellixia/cashmemo-api`, `cashmemo-web` and `cashmemo-worker`, tagged with the commit SHA and `latest`, on GitHub's runners (the Dokploy host's build containers can't resolve DNS);
  - its `deploy` job then points each Dokploy app at the new SHA and redeploys. This needs the secrets `DOKPLOY_URL`, `DOKPLOY_TOKEN`, `DOKPLOY_APP_API`, `DOKPLOY_APP_WEB` and `DOKPLOY_APP_WORKER`, and is skipped until they're set.
- **`uptime.yml`**: every 15 minutes, `GET https://cashmemo.andresholivin.dev/api/health` from GitHub's runners. A failure emails the repo owner. It's the off-host watchdog for when the whole server is down.
- **Dokploy project `cashmemo`** (images pulled with the GHCR registry credential):
  - `cashmemo-db` (Postgres 18), with daily backups to R2.
  - `cashmemo-api`: internal only. Env: `DATABASE_URL`, `COOKIE_SECURE=true`, `APP_URL`, `SENTRY_DSN`, `S3_*`.
  - `cashmemo-worker`: no ports. Env: `DATABASE_URL`, `SENTRY_DSN`, `S3_*`, `RESEND_API_KEY`, `MAIL_FROM`, `EMAIL_DAILY_CAP`.
  - `cashmemo-web`: domain `cashmemo.andresholivin.dev` over HTTPS via Cloudflare. Env: `API_URL=http://<api-service>:8080` (the GlitchTip DSN is baked in at build time from the repo variable).
- **Shared infrastructure** (not per app):
  - **GlitchTip** runs in the Dokploy project **Observability & Mgmt** next to OpenObserve, with one GlitchTip project per app (Cash Memo, Hortator, Kognovis…).
  - The **R2 backup destination** is org-wide in Dokploy (bucket `dokploy-backups`, a prefix per project).

## Operations

- **Errors, logs, uptime: GlitchTip** (self-hosted, Sentry-compatible, ~512 MB–1 GB RAM).
  - The API, worker and web send errors, and the Rust apps also send info+ logs.
  - An uptime monitor watches `/api/health`.
  - It runs on the same host, so the GitHub Actions watchdog covers the case where the host itself is down.
  - OpenObserve stays for infrastructure and container logs.
- **Email: Resend** free tier (100/day, 3,000/month, 10 req/s). The worker sends at most 5/s and holds mail past `EMAIL_DAILY_CAP` for an hour.
  - The sender domain needs SPF, DKIM and DMARC records in Cloudflare DNS.
  - Alternatives: Cloudflare Email Sending needs the Workers Paid plan. A Gmail address can't be the sender for either.
- **Backups:** a daily Dokploy backup of `cashmemo-db` to R2, kept 14 days.
  - **Restore drill** (run after setup, then quarterly):
    1. Create a scratch database: `CREATE DATABASE restore_check`.
    2. In Dokploy → cashmemo-db → Backups, restore the latest backup into `restore_check`, or download it and run `pg_restore -d restore_check <file>`.
    3. Compare counts with production: `SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM memos), (SELECT max(created_at) FROM memos);` The backup should be less than 24 hours behind.
    4. `DROP DATABASE restore_check`.
- **Stuck jobs:** jobs left `running` by a crashed worker for more than 15 minutes go back in the queue when the worker starts. Failed jobs keep their `error`: `SELECT kind, error, updated_at FROM jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 20;`

## Roadmap

The order is based on trust first, then less typing, then planning, then assistance. Each step builds on the one before it.
AI features are **opt-in**: they use your own history first, send only the minimum text to a model, never send account data, never train on it, and every suggestion shows why it was made.

### ✅ v1.0: Foundation (shipped)
- [x] Rust API (Axum + SeaORM) and Postgres, with migrations run on boot
- [x] Email/password auth: argon2id, hashed session tokens, same-time login
- [x] Memos CRUD with soft delete, and month boundaries in local time
- [x] Emoji categories, a starter set on first run, category/direction rule
- [x] Monthly summary per currency, category donut, day-grouped ledger with filters
- [x] Per-currency native formatting, currency picker, default currency
- [x] "Paper ledger" design with light/dark themes, responsive from 320px to wide desktop
- [x] PWA: installable, offline reading, update prompt, quiet install entry
- [x] Landing page, README
- [x] CI: lint, API tests, Playwright e2e on 4 viewports, GHCR images, Dokploy deploy

### ✅ v1.1: Sources, appearance, trust & data ownership
- [x] **Sources**: named cash/bank/e-wallet/credit/paylater sources, required on expenses
  - [x] Opt-in balance tracking with a currency lock and opening balance; "Owed" for credit and paylater
  - [x] Transfers between sources, excluded from income/expense (no double-counted card bills)
  - [x] Source filter, balances card, archive and restore
- [x] **Bottom navigation** redesigned: 5 even tabs with a centered add button
- [x] **Appearance**: 6 accent colors, 4 font pairs, larger text, no flash on load
- [x] **Password reset** by email (Resend), **change password**, **change email** with confirmation
- [x] **CSV export and import** with column mapping, preview, duplicate skipping, and background jobs that can't overload the database
- [x] **Delete my account**: password-confirmed hard delete, including stored files
- [x] **Ops**: `apps/worker` + Postgres job queue, auth rate limits, GlitchTip errors/logs/uptime, off-host watchdog, auto-deploy after green CI, R2 backups with a restore drill
- Dropped: sign-up email verification. It adds friction for little gain in a private journal: a reset link only ever goes to the address itself, and changing email is confirmed from the new address.

### ✅ v1.2: Less typing, more planning
- [x] **Recurring memos** (runs in `apps/worker`)
  - [x] `recurring_rules` table: amount, currency, category, source, cadence (weekly/monthly/yearly), next date
  - [x] The worker creates due memos every 15 minutes (idempotent, with catch-up), and the ledger shows "upcoming" rows
  - [x] Create from the editor ("Repeat") or from an existing memo; pause, edit, stop
- [x] **Credit & paylater plans**: installments (3/6/12×, or 2–36) with fees, statement and due dates, in-app reminders, credit limit on the balances card
- [x] **Budgets per category**
  - [x] Monthly limit per category and currency
  - [x] Progress bars on the home page, with recurring memos included in the projection
  - [x] Nudge at 80% and 100% (in-app; push notifications later)
- [x] **Search**: search over notes, categories and sources across months
- [x] **Keyboard shortcuts** on desktop (`n` new memo, `←/→` month, `/` search)
- [x] **Appearance sync** across devices (saved on the account)
- [x] From issues: **Settings** split from Account (#14), accent palettes for the whole app (#12), font previews and two more pairs (#13), live emoji preview (#11), **Undo** for deletes and archives (#17), **receipt photos** (#15), a **Reports** page (#16)

### v1.3: Smart assist (AI, opt-in)
- [ ] **Settings**: "Smart suggestions" toggle (off by default) with a plain-language data notice
- [ ] **Category and source suggestions**: pick them from the note as you type, using local frequency matching on your own memos (no AI call)
- [ ] **Quick add in plain words**
  - [ ] Deterministic parser: amount + shorthand (`45k`, `1,5jt`), currency, relative dates ("yesterday", "last friday"), category and source hints ("gopay")
  - [ ] Optional LLM fallback for free-form text, sending only the typed sentence
  - [ ] Always a reviewable draft; nothing is saved without confirmation
- [ ] **Pattern detection**
  - [ ] "Looks like a monthly subscription. Make it recurring?"
  - [ ] Possible duplicates (same amount, category and day)
  - [ ] Unusual spikes against your 3-month average
- [ ] **Monthly recap**: a short plain-language summary generated from aggregated numbers only (no notes or names)

### v2: Bigger features
- [ ] **Insights & reports**: year view and source history (6/12-month trends and month-to-month comparison shipped in v1.2)
- [ ] **Voice capture**: speak a memo, which goes into quick add; audio is transcribed and immediately discarded
- [ ] **Converted totals (optional)**: one combined total in your default currency using daily reference rates, with originals always kept; cross-currency transfers
- [ ] **Offline editing + sync**: queue changes offline and resolve conflicts on reconnect
- [ ] **Shared spaces**: a household or trip journal with invites, roles and per-member attribution
- [ ] **Push notifications**: budget nudges and recurring reminders (opt-in)

Have an idea or a different priority? Open an issue.
