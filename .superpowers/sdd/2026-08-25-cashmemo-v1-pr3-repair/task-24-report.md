# Task 24 report — Responsive, accessibility, and human visual review

## Status

Task 24 implementation complete on `rewrite/cashmemo-v1` from `b1e7ab5`. Final commit is created
only after required checks pass. Protected `.claude/settings.json`, `.serena/`, `AGENTS.md`, and
`CLAUDE.md` were not edited by this recovery.

## Delivered

- Pinned exact `@axe-core/playwright` **4.13.0** in `apps/web/package.json` and `pnpm-lock.yaml`.
- Added Playwright bounded output/report paths, failure trace/screenshot/video retention, and
  private 7-day artifact upload in `.github/workflows/v1-ci.yml`; added `workflow_dispatch` boolean
  `capture_visual_review`; ignored `apps/web/test-results/` and `apps/web/playwright-report/`.
- Added loopback-only public-origin guard before E2E authentication/capture; fixtures use only
  `example.test` identities and synthetic values.
- Added real axe and behavioral browser checks for skip-link, keyboard/focus restoration, reduced
  motion, 200% reflow, overflow, safe area, small height, headings, and textual/non-color status.
- Added exact fixed viewport visual capture for login, onboarding, dashboard, new transaction,
  history filters/long scroll, wallets, budgets, recurring, settings, account deletion, and
  deletion-only states. Final set is documented in `docs/verification/v1-pr3-visual-review.md`.
- Human image review found and fixed: dashboard metric overlap at 768/1280, mobile hidden-sidebar
  grid-track shrinkage, and settings captures taken during loading. Each fix has focused test
  evidence and final recapture. UI remains forest green, warm neutral, restrained amber, semantic
  destructive/status colors, and neutral surfaces.
- Primitive inventory records one shadcn/Base UI interaction system and concrete rationale for
  retained native date/month/select controls: `docs/verification/v1-pr3-ui-primitive-inventory.md`.

## TDD and verification evidence

Final required browser sweep (rendered geometry and accessibility GREEN):

```text
pnpm --dir apps/web exec playwright test e2e/accessibility.spec.ts e2e/visual-review.spec.ts
3 passed (1.4m)
```

Final quality commands:

```text
pnpm --dir apps/web test --run --maxWorkers=1
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web build
```

All serialized commands passed in Node 24.14.0 / pnpm 11.13.1 CI toolchain. An unbounded parallel
Vitest invocation was flaky (6 cross-file timeouts/interference); the required full suite is green
serialized at 18 files / 181 tests. Local recovery host reports Node 22.19.0; this is an environment
concern only, not a CI acceptance result. No production, push, merge, deploy, or Dokploy action was
performed.

## Fix round 1 — rendered geometry and small-height reachability

Date: 2026-08-30. Reviewer follow-up replaced former source-regex-only CSS assertions in
`apps/web/tests/accessibility.spec.tsx` with rendered Playwright geometry checks in
`apps/web/e2e/visual-review.spec.ts`:

- `expectDashboardMetricGeometry` visits dense two-currency dashboard at exact `768x1024` and
  `1280x800` viewports. It reads each `.summary-grid` computed track count, every metric
  card/`dt`/`dd` bounding box, asserts containment in grid/card, rejects label/value and
  metric/metric collisions, rejects clipped values.
- `expectMobileShellGeometry` visits dense wallets at exact `375x812`, asserts one shell track,
  `display:none`/zero-width sidebar, full-width main content, each management row inside usable
  content width, document `scrollWidth <= clientWidth`.
- Behavioral RED was proven with temporary CSS mutations, then reverted before final capture:
  mobile `.app-shell` mutation failed `hidden sidebar must not create a mobile grid track`
  (`Expected: 1`, `Received: 2`); tablet `.summary-grid` mutation failed
  `dashboard metric columns at 1280px` (`Expected: 2`, `Received: 3`).
- Small-height behavioral coverage now runs at `375x500` for representative long Budget and
  Recurring forms. It focuses/scrolls `Create budget`, `New recurring rule`, and recurring
  dialog's `Create recurring rule` above fixed Mobile navigation, and asserts no horizontal
  overflow. Transaction form retains existing focus/inset coverage.

Final GREEN recapture after restoring both CSS mutations: visual review test passed, regenerated
all 48 synthetic captures, affected dashboard/wallet screenshots were inspected with image viewer.
Geometry checks provide computed safe-area/overflow and bottom-nav reachability evidence; no new
visual finding remains.
