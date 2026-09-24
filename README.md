# Cash Memo

**Your private money journal.** Jot down money in and out in any currency, and see where each month went at a glance. There are no bank connections, no ads and no data selling.

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
- [Security & privacy](#security--privacy)
- [PWA & offline](#pwa--offline)
- [Testing](#testing)
- [CI/CD & deployment](#cicd--deployment)
- [Roadmap](#roadmap)

---

## Features

- **Memos**: income or expense, amount, currency, date and time, optional category and note. Create, edit and delete from a bottom sheet on phones or a dialog on larger screens.
- **Any currency, shown the way it's written there**: `Rp 7.500.000`, `$7,500.00`, `7.500,00 €`, `¥7,500`. The amount input follows the same separators and decimals.
- **Default currency**: set per account. It's guessed from your region at sign-up and can be changed in Account.
- **Month at a glance**: net for the month, an income-vs-expense bar, a spending-by-category donut, a card per currency when you use several, and a ledger grouped by day with income/expense and category filters.
- **Emoji categories**: separate lists for income and expense, with a one-click starter set on first run and rename/emoji/delete on the Categories page.
- **Works everywhere**: responsive from 320px phones to wide desktops.
  - Bottom tabs on phones, a top bar from tablet size up.
  - A two-column dashboard on desktop.
  - Light, dark or system theme.
- **Installable & offline-readable (PWA)**:
  - Install it like an app. The install entry is offered quietly in the account menu and on the Account page, never as a popup.
  - Screens you've already opened still work offline.
- **Private by default**: see [Security & privacy](#security--privacy).

## Tech stack

| Layer | Choice |
|---|---|
| Monorepo | [Turborepo](https://turborepo.com) + Bun workspaces (JS), Cargo workspace (Rust) |
| Backend | Rust, [Axum 0.8](https://github.com/tokio-rs/axum), [SeaORM 2](https://www.sea-ql.org/SeaORM/) (sqlx/Postgres), argon2id (`password-auth`) |
| Database | PostgreSQL 18 |
| Frontend | [Next.js 16](https://nextjs.org) (App Router) on [Bun](https://bun.sh), React 19, TypeScript |
| UI | Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com) on Base UI, lucide icons, Fraunces + Geist fonts |
| State & data | TanStack Query (server state), zustand (UI state), react-hook-form + zod (forms) |
| Testing | `cargo test` (API integration against real Postgres), `bun test` (money helpers), Playwright (e2e, 4 viewports) |
| Delivery | GitHub Actions → GHCR images → [Dokploy](https://dokploy.com) |

## Architecture

```
 Browser / installed PWA
   │  same origin: cashmemo.andresholivin.dev
   ▼
 ┌──────────────────────────────┐
 │  web  (Next.js on Bun)       │  pages, landing, PWA (service worker)
 │  /api/* ── runtime proxy ────┼──┐  forwards method, body, cookie; returns status + Set-Cookie
 └──────────────────────────────┘  │
                                   ▼
                    ┌──────────────────────────┐
                    │  api  (Rust / Axum)      │  auth, memos, categories, summary
                    │  internal only, :8080    │  runs migrations on boot
                    └────────────┬─────────────┘
                                 ▼
                         PostgreSQL 18
```

- **One origin.** The browser only ever talks to the Next app. Its `/api/[...path]` route handler proxies to the API at runtime (`API_URL`), so session cookies are first-party and there's no CORS.
- **Sessions** are opaque random tokens in an `HttpOnly; SameSite=Lax` cookie (plus `Secure` in production). Only the token's SHA-256 is stored.
- **Auth gate.** `proxy.ts` (Next middleware) shows the landing page at `/` to signed-out visitors and sends other app routes to `/login` when there's no session cookie. The API is the real authority: every query is scoped to the session's user.

## Repository layout

```
apps/
  api/                    Rust API (crate `api`)
    src/main.rs           startup: env, DB pool, migrations, graceful shutdown
    src/lib.rs            router, AppState, /health, shared validators
    src/auth.rs           signup / login / logout / me, session extractor
    src/memos.rs          memos CRUD + monthly summary
    src/categories.rs     categories CRUD (emoji)
    src/error.rs          AppError → { "error": "..." } + JSON-shaped extractors
    src/entities.rs       SeaORM entities
    migration/            SeaORM migrations (plain SQL)
    tests/api.rs          end-to-end API test against real Postgres
    Dockerfile
  web/                    Next.js app (package `web`)
    app/                  routes: (app)/ home, categories, account · login · signup · welcome (landing) · offline
    app/api/[...path]/    runtime proxy to the API
    components/           app shell, summary, ledger, memo editor, landing, pwa …
    components/ui/        shadcn components (Base UI)
    lib/                  api client, money/currency helpers, queries, store, install, online
    public/sw.js          service worker
    e2e/                  Playwright specs
    Dockerfile
docker-compose.yml        local Postgres
turbo.json · package.json · Cargo.toml
```

## Getting started

Prerequisites: [Bun](https://bun.sh) ≥ 1.4, Rust (stable), Docker (for Postgres).

```sh
cp .env.example .env
docker compose up -d db        # or docker-compose
bun install
bun run dev                    # api on :8080, web on :3000
```

Open http://localhost:3000, create an account, and add the starter categories.

## Configuration

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | api | — (required) | `postgres://user:pass@host:5432/db` |
| `PORT` | api / web | `8080` / `3000` | |
| `COOKIE_SECURE` | api | `false` | set `true` behind HTTPS |
| `RUST_LOG` | api | `info,sqlx=warn` | tracing filter |
| `API_URL` | web | `http://localhost:8080` | where the web proxy forwards `/api/*` (read at runtime) |

The API loads `.env` from the repo root in development (`dotenvy`).

## Scripts

From the repo root (Turborepo runs both apps):

| Command | What it does |
|---|---|
| `bun run dev` | API (`cargo run`) + web (`next dev`) |
| `bun run build` | release API build + Next production build |
| `bun run test` | API integration test (needs the local DB) |
| `bun run lint` | `cargo fmt --check` + `clippy -D warnings` + ESLint |

In `apps/web`:

| Command | What it does |
|---|---|
| `bun test lib` | money/currency unit tests |
| `bun run test:e2e` | Playwright against a running app (`BASE_URL`, default `http://localhost:3000`) |
| `bun run screenshots` | renders review screenshots of every screen into `e2e/screenshots/` |

## API

All routes are under `/api` and use JSON. Errors are always `{ "error": string }` with a matching status code (400, 401, 404, 409 or 500). Authenticated routes need the `session` cookie.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | | 200 if the DB is reachable, else 503 |
| POST | `/auth/signup` | `{ email, password (8–256), default_currency? }` | `User` + cookie · 409 if the email is taken |
| POST | `/auth/login` | `{ email, password }` | `User` + cookie · 401 |
| POST | `/auth/logout` | | 204, clears the cookie |
| GET | `/auth/me` | | `User` |
| PATCH | `/auth/me` | `{ default_currency }` | `User` |
| GET | `/memos` | `?month=YYYY-MM&offset=<min east of UTC>[&category_id=]` | `Memo[]`, newest first |
| POST | `/memos` | `{ direction, amount_minor>0, currency, occurred_at, category_id?, note? }` | 201 `Memo` |
| GET / PATCH / DELETE | `/memos/:id` | PATCH takes any subset; `null` clears `category_id` / `note` | `Memo` / 204 (soft delete) |
| GET | `/categories` | | `Category[]` |
| POST | `/categories` | `{ name, direction, emoji? }` | 201 `Category` · 409 on a duplicate |
| PATCH | `/categories/:id` | `{ name?, emoji? }` (`emoji: null` clears it) | `Category` |
| DELETE | `/categories/:id` | | 204. Its memos keep existing, uncategorized |
| GET | `/summary` | `?month=YYYY-MM&offset=` | `{ month, totals[], by_category[] }`, per currency and direction |

```ts
type User     = { id: string; email: string; default_currency: string };
type Memo     = { id; direction: "income" | "expense"; amount_minor: number; currency: string;
                  occurred_at: string; category_id: string | null; note: string | null;
                  created_at: string; updated_at: string };
type Category = { id: string; name: string; direction: "income" | "expense"; emoji: string | null };
```

`offset` makes month boundaries follow the viewer's local time. For example, a memo at 03:00 on 1 October in Jakarta (UTC+7) belongs to October, even though it is still 30 September in UTC.

## Data model

| Table | Key columns |
|---|---|
| `users` | `id uuid`, `email` (unique, lowercase), `password_hash` (argon2id), `default_currency char(3)`, `created_at` |
| `sessions` | `token_hash bytea` (sha256 of the cookie token), `user_id` → users (cascade), `expires_at` (30 days) |
| `categories` | `id`, `user_id`, `name` (1–100), `direction` (income/expense), `emoji` (≤ 8 chars), unique `(user_id, name, direction)` |
| `memos` | `id`, `user_id`, `direction`, `amount_minor bigint > 0`, `currency char(3)`, `occurred_at timestamptz`, `category_id` (set null on delete), `note`, `deleted_at` (soft delete), timestamps, index `(user_id, occurred_at desc)` |

Migrations live in `apps/api/migration` and run automatically when the API starts.

## Money & currency rules

- **Amounts are integers in minor units** (`amount_minor`), paired with an ISO 4217 code. There are no floats anywhere.
- **The minor-unit exponent is fixed per currency** (for example USD 2, IDR 0, JPY 0). It comes from `Intl` in the fixed `en` locale, with the ~17 currencies where browser engines disagree pinned in `lib/money.ts`, so a stored amount means the same thing in every browser.
- **Display uses the currency's home format** (IDR in `id-ID`, EUR in `de-DE`, INR in `en-IN` …). Display never changes the stored value.
- **No conversion.** Totals are always per currency. Converted totals are on the [roadmap](#roadmap).

## Security & privacy

- **Passwords:** hashed with argon2id, off the async runtime. Login takes the same time whether or not the email exists.
- **Sessions:** random 32-byte tokens stored hashed. The cookie is `HttpOnly`, `SameSite=Lax` and `Secure`. Expired sessions are swept on login.
- **Per-user data:** every data query is filtered by the session's user id. Another user's id returns 404.
- **Validation:** every input is validated server-side (direction, positive amounts, currency shape, category ownership and direction match). Database `CHECK` constraints are a second guard.
- **Offline cache:** the service worker wipes its cache of API data on login, sign-up and logout, so a shared device never shows the previous user's data.
- **No third parties:** no bank connections, no analytics, no ads.

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

- **API:** `cargo test`. One end-to-end flow against real Postgres covers auth, memos across currencies, local-time month boundaries, partial updates, category/direction rules, per-category summary, the error shape and user isolation.
- **Money helpers:** `bun test lib` covers formatting and parsing for each currency's separators and decimals.
- **E2E:** Playwright across `desktop` 1280, `mobile` 390, `tablet` 820 and `wide` 1440.
  - Every user-facing flow is covered: auth, account menu, theme, month switching, memo add/edit/delete/validation, filters, currencies, categories, landing, responsive layout at each breakpoint, no horizontal overflow at 320px, PWA manifest/offline/cache wipe.
  - Any console error or page error fails a test.

```sh
docker compose up -d db
cargo build --release -p api && ./target/release/api &
cd apps/web && bun run build && PORT=3000 bun run start &
bun run test:e2e
```

## CI/CD & deployment

- **`ci.yml`** (push to `v1`, PRs):
  - `check` job: lint, API tests and build.
  - `e2e` job: Postgres service, then the release API, then the web production build, then Playwright on all viewports.
- **`images.yml`** (push to `v1`): builds `ghcr.io/vellixia/cashmemo-api` and `cashmemo-web`, tagged with the commit SHA and `v1`. Images are built on GitHub's runners because the Dokploy host's build containers can't resolve DNS.
- **Dokploy project `cashmemo`**:
  - `cashmemo-db` (Postgres 18).
  - `cashmemo-api`: internal only. Env: `DATABASE_URL`, `COOKIE_SECURE=true`.
  - `cashmemo-web`: domain `cashmemo.andresholivin.dev` over HTTPS via Cloudflare. Env: `API_URL=http://<api-service>:8080`.
  - Images are pulled with the GHCR registry credential.
- **Deploying today:** set both apps' image tag to the new SHA in Dokploy, then redeploy. Automating this is on the roadmap.

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

### v1.1: Trust & data ownership
- [ ] **Password reset**
  - [ ] Choose and configure an email provider (e.g. Resend) + sender domain (SPF/DKIM)
  - [ ] `password_resets` table: hashed single-use token, 1h expiry
  - [ ] `POST /auth/password-reset/request` (same response whether or not the email exists)
  - [ ] `POST /auth/password-reset/complete`, which revokes all other sessions
  - [ ] "Forgot password?" and reset pages, plus e2e
- [ ] **Email verification**
  - [ ] Verify link on sign-up, `email_verified_at` column
  - [ ] Banner until verified, resend link
- [ ] **Change password / email** on the Account page (needs the current password)
- [ ] **CSV export**
  - [ ] `GET /export.csv`: all memos with category names, ISO dates, decimal amounts and currency
  - [ ] "Export my data" button on Account
- [ ] **CSV import**
  - [ ] Upload, then column-mapping preview (date, amount, currency, direction, category, note)
  - [ ] Dry-run with a row-level error report, then a single-transaction import
  - [ ] Creates missing categories and skips duplicates
- [ ] **Delete my account**: confirm with password, hard-delete all data
- [ ] **Ops hardening**
  - [ ] Login/sign-up rate limiting (web proxy forwards the client IP)
  - [ ] Auto-deploy: CI updates the Dokploy image tag and redeploys after green e2e
  - [ ] Scheduled Postgres backups (Dokploy backup → S3-compatible storage) and a restore drill
  - [ ] Error tracking and uptime check

### v1.2: Less typing, more planning
- [ ] **Recurring memos**
  - [ ] `recurring_rules` table: amount, currency, category, cadence (weekly/monthly/yearly), next date
  - [ ] Daily job materializes due memos (idempotent) and shows "upcoming" rows in the ledger
  - [ ] Create from the editor ("Repeat monthly") or from an existing memo; pause, edit, stop
- [ ] **Budgets per category**
  - [ ] Monthly limit per category and currency
  - [ ] Progress bars on the home page, with recurring memos included in the projection
  - [ ] Nudge at 80% and 100% (in-app; push notifications later)
- [ ] **Search**: full-text search over notes and categories across months
- [ ] **Keyboard shortcuts** on desktop (`n` new memo, `←/→` month, `/` search)

### v1.3: Smart assist (AI, opt-in)
- [ ] **Settings**: "Smart suggestions" toggle (off by default) with a plain-language data notice
- [ ] **Category suggestions**: pick the category from the note as you type, using local frequency matching on your own memos (no AI call)
- [ ] **Quick add in plain words**
  - [ ] Deterministic parser: amount + shorthand (`45k`, `1,5jt`), currency, relative dates ("yesterday", "last friday"), category hint
  - [ ] Optional LLM fallback for free-form text, sending only the typed sentence
  - [ ] Always a reviewable draft; nothing is saved without confirmation
- [ ] **Pattern detection**
  - [ ] "Looks like a monthly subscription. Make it recurring?"
  - [ ] Possible duplicates (same amount, category and day)
  - [ ] Unusual spikes against your 3-month average
- [ ] **Monthly recap**: a short plain-language summary generated from aggregated numbers only (no notes or names)

### v2: Bigger features
- [ ] **Insights & reports**: year view, trends, month-to-month comparison, category history
- [ ] **Voice capture**: speak a memo, which goes into quick add; audio is transcribed and immediately discarded
- [ ] **Converted totals (optional)**: one combined total in your default currency using daily reference rates, with originals always kept
- [ ] **Offline editing + sync**: queue changes offline and resolve conflicts on reconnect
- [ ] **Shared spaces**: a household or trip journal with invites, roles and per-member attribution
- [ ] **Attachments**: receipt photos (private object storage, stripped EXIF)
- [ ] **Push notifications**: budget nudges and recurring reminders (opt-in)

Have an idea or a different priority? Open an issue.
