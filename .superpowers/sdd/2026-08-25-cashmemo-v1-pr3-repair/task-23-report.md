# Task 23 report: account-deletion UX and browser privacy boundary

## Implementation

- Added `apps/web/lib/query-client.ts` as the single QueryClient owner and private-state cleanup boundary. Cleanup aborts in-flight requests, clears query objects immediately, and awaits cancellation before replace navigation.
- Reused cleanup through `clearSessionState`, which preserves Task 15/22 call-site semantics while preventing late results from repopulating removed state.
- Account-deletion request now consumes server `deletion_due_at`, displays authoritative deadline plus live-data/backup-retention copy, clears private state only after successful server response, and then enters restricted navigation.
- Restricted deletion composition remains separate from AppShell. Password cancellation keeps wrong-password failures inline; successful cancellation clears private state and replaces with `/login`.
- Added component/cache tests and expanded account-deletion browser evidence for storage, CacheStorage, IndexedDB, no-store responses, restricted financial-request isolation, and fresh-auth cleanup.

## Files

Modified: `apps/web/features/settings/account-deletion.tsx`, `apps/web/app/(auth)/deletion/page.tsx`, `apps/web/components/auth-gate.tsx` (no change required), `apps/web/lib/auth/session.ts`, `apps/web/lib/query/provider.tsx`, `apps/web/tests/cache-policy.spec.tsx`, `apps/web/e2e/account-deletion.spec.ts`.

Created: `apps/web/lib/query-client.ts`, `apps/web/tests/account-deletion.spec.tsx`.

## TDD transcript

RED: `pnpm --dir apps/web exec vitest run tests/account-deletion.spec.tsx tests/cache-policy.spec.tsx` failed because `../lib/query-client` did not exist; this was the intended missing-boundary failure. Initial brief command form (`pnpm --dir apps/web vitest ...`) was rejected by installed pnpm as `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "apps/web" not found`.

GREEN: focused tests pass `9/9`; auth/settings/accessibility regressions pass `70/70`.

## Fix round 1 evidence

Behavioral RED against temporary pre-fix `clearPrivateQueryState = queryClient.clear()`:

```text
FAIL tests/account-deletion.spec.tsx > private query isolation > aborts in-flight financial requests and blocks late results from returning to cache
AssertionError: expected "cancelQueries" to be called 1 times, but got 0 times
```

Test uses real TanStack Query in-flight state and held promise; legacy cancellation-only baseline proves prior private data remains reusable. Restoring cancel + clear + awaited cancellation produced GREEN, 3/3, then focused suite 10/10.

First fix-round E2E attempt found exact route glob missed query-string URL (`aRequestSeen` remained false), plus browser cache was validly empty. Final route uses `**/api/v1/**` with pathname/method guard; cache assertions reject every unexpected cache name/key when present. Final fresh-service E2E passed 2/2, 1.1m.

Browser cookie metadata passed without exposing value: `__Host-cashmemo_session`, `secure=true`, `httpOnly=true`, `sameSite=Lax`, `path=/`, host-only `domain=localhost`.

Round 2 delivery evidence: a same-context hidden browser page issued User A's real `/api/v1/transactions?limit=50` request. The route fetched and validated upstream body while A was authenticated, held only `route.fulfill()`, then main page logged out, logged User B in, and released fulfillment. Awaited `latePage.evaluate(fetch).text()` resolved `200` with A sentinel, proving browser receipt after cleanup; main B UI, QueryClient, CacheStorage, and storage showed no A sentinel. No cookie/token value was logged.

## Fix round 3 evidence

Replaced hidden raw-fetch evidence with production main-app query evidence. The same visible User A page navigates to `/app/transactions`, where the mounted History component starts generated-client `GET /api/v1/transactions?limit=50`. Route interception fetches upstream under A's valid cookie, validates the synthetic A note in the actual response body, and holds only browser delivery. The page then uses Settings → Sessions → “Sign out this session”; successful cleanup and fresh User B login occur on the same page and QueryClient owner before held fulfillment is released. `route.fulfill` is attempted after B initialization. Production cleanup aborts the held browser request during logout, so Playwright records the exact held request as `failed` before release; fulfillment attempt still executes after B and is explicitly awaited. B History, wallets, overview, QueryClient behavior, CacheStorage, storage, and IndexedDB contain no A sentinel. No cookie/token value is logged.

Initial round-3 RED: first production E2E assertion filtered request outcome to events after release, but cleanup correctly aborted the held production query before release; exact failure was `expect(received).toMatch(expected)` with `received value: undefined`, timeout at `cache-isolation.spec.ts:139`, while `aFulfillAttempted` had completed. Fix records the exact held request's `finished|failed` outcome at any point, separately asserts post-B `route.fulfill` attempt, and keeps late-result isolation assertions. Cache-only rerun passed 1/1 (40.9s); required fresh-service pair passed 2/2 (1.1m).

## Verification

- `pnpm --dir apps/web exec vitest run tests/account-deletion.spec.tsx tests/cache-policy.spec.tsx` — PASS, 9/9.
- `pnpm --dir apps/web exec vitest run tests/auth.spec.tsx tests/settings.spec.tsx tests/accessibility.spec.tsx` — PASS, 70/70.
- `pnpm --dir apps/web exec eslint features/settings/account-deletion.tsx 'app/(auth)/deletion/page.tsx' lib/query-client.ts lib/query/provider.tsx lib/auth/session.ts tests/account-deletion.spec.tsx` — PASS.
- `pnpm --dir apps/web exec tsc --noEmit` — PASS.
- `git diff --check` — PASS.

## Self-review / concerns

- Node24 path: `/Users/andresholivin/.nvm/versions/node/v24.14.0/bin`.
- Fresh-service Chromium E2E: `pnpm --dir apps/web exec playwright test e2e/account-deletion.spec.ts e2e/cache-isolation.spec.ts` — PASS, 2/2 (49.3s). E2E exposed and fixed a missing all-sessions confirmation click and stale loading locator; browser assertions now exercise no-store responses, restricted no-financial-requests, local/session storage, CacheStorage body privacy, and IndexedDB absence.
- Exact cleanup: `docker-compose -f infra/v1/test-compose.yml down -v --remove-orphans` — PASS; Postgres/Mailpit containers, network, and disposable volumes removed.
- Node24 `pnpm toolchain:check` — PASS (`node=24.14.0`, `pnpm=11.13.1`). Full web Vitest — PASS, 180/180 (parallel run had 3 unrelated 5s resource-contention timeouts; isolated rerun passed). Focused — PASS, 10/10. Full lint, typecheck, and build — PASS.
- Fix-round-2 final Node24 full web Vitest — PASS, 180/180 isolated; lint, typecheck, and build — PASS. Focused cache/deletion Vitest — PASS, 10/10. Fresh-service Chromium E2E — PASS, 2/2 (53.7s); exact compose cleanup and empty `ps --all` verified.
- Fix-round-3 focused ESLint — PASS; focused TypeScript — PASS; focused cache/deletion Vitest — PASS, 10/10.
- Fix-round-3 Node24 `pnpm toolchain:check` — PASS (`node=24.14.0`, `pnpm=11.13.1`); full web Vitest — PASS, 180/180 (16.42s); full lint — PASS; full typecheck — PASS; production build — PASS.
- Fix-round-3 fresh-service Chromium E2E — initial RED timed out on premature post-release-only outcome filter; after fix required `pnpm --dir apps/web exec playwright test e2e/account-deletion.spec.ts e2e/cache-isolation.spec.ts` — PASS, 2/2 (1.1m). Exact cleanup after failed, cache-only, and final runs: `docker-compose -f infra/v1/test-compose.yml down -v --remove-orphans`; `docker-compose -f infra/v1/test-compose.yml ps --all` returned header with no containers.
- Existing protected files `.claude/settings.json`, `.serena/`, `AGENTS.md`, and `CLAUDE.md` remain untouched/unstaged.
- No React-side deadline arithmetic or browser token persistence added; server cookie remains authoritative.

## Fix round 4 evidence

Root-cause review found round 3 navigated from History to Settings before logout. That unmounted the
History observer, and `gcTime: 0` plus query cancellation could abort the held request independently
of `clearSessionState`. The smallest product-compatible composition change reuses one
`CurrentSessionSignOut` action in Settings, the desktop sidebar, and the mobile More sheet. It keeps
one logout mutation/cleanup implementation and adds no test hook, hidden fetch, alternate
QueryClient, or parallel auth path.

Initial UI RED, fresh services:

```text
locator.click: Test timeout of 60000ms exceeded.
waiting for getByRole('button', { name: 'Sign out this session' })
```

The RED occurred on `/app/transactions` after the production History query had started and its
authenticated User A upstream body had been validated. After composing the shared shell action,
focused Vitest passed 34/34 and the fresh cache-isolation browser test passed 1/1.

The final browser proof holds the real History response and verifies it is pending both when the
real `POST /api/v1/auth/logout` starts and when its successful response arrives. It also holds the
subsequent `/login` navigation response, leaving the History loading UI and its query observer
mounted. Production cleanup must abort the exact held request before that navigation is released.
Only then may login commit, User B authenticate in the same page and singleton QueryClient, and the
held User A route attempt late fulfillment. Existing User B UI/cache, cookie metadata,
localStorage/sessionStorage, IndexedDB, CacheStorage allowlist/body, and ownership-isolation checks
remain in the same test.

Genuine mutation RED removed `clearSessionState(client)` from the shared current-session logout
action. With the actual logout response complete and login navigation still held, the actively
observed History request remained pending for the full 5-second causal window:

```text
logout cleanup must abort held History request before held login navigation commits
Expected: "failed"
Received: undefined
Timeout 5000ms exceeded while waiting on the predicate
```

Restoring the cleanup produced fresh GREEN: focused Vitest 34/34; cache-isolation Chromium 1/1
(38.3s including services). Final Node 24.14.0 verification: toolchain check passed with pnpm
11.13.1; full web Vitest 180/180; full lint, typecheck, and production build passed. Final required
fresh-service Chromium pair passed 2/2 (49.2s). Exact `docker-compose -f
infra/v1/test-compose.yml down -v --remove-orphans` cleanup passed and `ps --all` returned no
containers.
