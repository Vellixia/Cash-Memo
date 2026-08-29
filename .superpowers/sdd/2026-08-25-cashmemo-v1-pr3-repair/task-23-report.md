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
- Node24 `pnpm toolchain:check` — PASS (`node=24.14.0`, `pnpm=11.13.1`). Full web Vitest — PASS, 179/179. Focused — PASS, 9/9. Full lint, typecheck, and build — PASS.
- Existing protected files `.claude/settings.json`, `.serena/`, `AGENTS.md`, and `CLAUDE.md` remain untouched/unstaged.
- No React-side deadline arithmetic or browser token persistence added; server cookie remains authoritative.
