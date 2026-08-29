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

Initial focused RED was captured before each responsive fix:

```text
reflows dense currency metrics before values can overlap at tablet widths: 1 failed, 11 skipped
gives hidden-sidebar mobile content the full viewport track: 1 failed, 12 skipped
```

Focused GREEN after fixes: 2/2. Final required browser sweep:

```text
pnpm --dir apps/web exec playwright test e2e/accessibility.spec.ts e2e/visual-review.spec.ts
3 passed (1.4m)
```

Final quality commands:

```text
pnpm --dir apps/web test --run
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web build
```

All commands passed in Node 24.14.0 / pnpm 11.13.1 CI toolchain. Local recovery host reports
Node 22.19.0; this is an environment concern only, not a CI acceptance result. No production,
push, merge, deploy, or Dokploy action was performed.

