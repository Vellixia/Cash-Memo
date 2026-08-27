# Task 14 Report — Tailwind and current shadcn/Base UI foundation

Date: 2026-08-27
Branch: `rewrite/cashmemo-v1`
Starting/base SHA: `d336ac812adb56b5485f58502d48cd83609361d0`
Signed commit SHA: `PENDING`

## Files Changed

- `apps/web/components.json`
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `apps/web/tsconfig.json`
- `apps/web/postcss.config.mjs`
- `apps/web/app/globals.css`
- `apps/web/app/layout.tsx`
- `apps/web/lib/utils.ts`
- `apps/web/components/ui/button.tsx`
- `apps/web/components/ui/input.tsx`
- `apps/web/components/ui/card.tsx`
- `apps/web/components/ui/label.tsx`
- `apps/web/components/ui/separator.tsx`
- `apps/web/components/ui/skeleton.tsx`
- `apps/web/components/ui/sonner.tsx`
- `apps/web/tests/design-system.spec.tsx`
- `apps/web/vitest.config.ts`
- `apps/web/features/dashboard/dashboard.tsx`
- `apps/web/tests/transaction-form.spec.tsx`
- `docs/verification/v1-pr3-ui-primitive-inventory.md`

## Toolchain

Required:

- Node `24.14.0`
- pnpm `11.13.1`

Verified command:

```bash
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm toolchain:check
```

Output:

```text
Toolchain verified: node=24.14.0, pnpm=11.13.1
```

Ambient shell mismatch found before execution:

```text
node v22.19.0
pnpm 11.13.1
```

## CLI Version Resolution

Source command:

```bash
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm view shadcn version --json
```

Output:

```text
"4.19.0"
```

Pinned install:

```bash
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir=apps/web add --save-dev --save-exact shadcn@4.19.0
```

## RED Evidence

Focused test file added first:

```bash
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir=apps/web exec vitest run tests/design-system.spec.tsx
```

Initial RED:

- `components.json` missing.
- `Button` still emitted `button-primary`.
- `globals.css` lacked `--primary` and still contained `.button-primary/.button-secondary/.button-danger/.button-quiet`.
- root layout mounted zero `Toaster` hosts.

Exact stale-command contradiction from brief:

```bash
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir apps/web vitest run tests/design-system.spec.tsx
```

Output:

```text
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "apps/web" not found
```

## Generator Commands And Output

Pre-req fixes required before CLI would initialize existing app:

- add TS alias in `apps/web/tsconfig.json`
- add Tailwind v4 deps
- add `@tailwindcss/postcss` plugin
- add `@import "tailwindcss";` bootstrap line so CLI preflight detects Tailwind

First `init` contradiction:

```bash
pnpm --dir=apps/web exec shadcn init --template next --base base --no-monorepo --yes
```

Observed behavior: still prompted for preset despite `--yes`.

Second `init` contradiction:

```bash
pnpm --dir=apps/web exec shadcn init --template next --base base --preset base-nova --no-monorepo --yes
```

Output:

```text
Invalid preset: base-nova. Available presets: nova, vega, maia, lyra, mira, luma, sera, rhea
```

Working init:

```bash
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH \
pnpm --dir=apps/web exec shadcn init --template next --base base --preset nova --no-monorepo --yes
```

Key output:

```text
✔ Writing components.json.
✔ Installing dependencies.
✔ Created 1 file:
  - lib/utils.ts
ℹ Updated 1 file:
  - components/ui/button.tsx
✔ Updating app/globals.css
Project initialization completed.
```

Working component add:

```bash
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH \
pnpm --dir=apps/web exec shadcn add button input card label separator skeleton sonner --overwrite --yes
```

Key output:

```text
✔ Created 5 files:
  - components/ui/card.tsx
  - components/ui/label.tsx
  - components/ui/separator.tsx
  - components/ui/skeleton.tsx
  - components/ui/sonner.tsx
ℹ Updated 1 file:
  - components/ui/input.tsx
ℹ Skipped 1 file:
  - components/ui/button.tsx
```

## Substrate Audit

- `button.tsx` uses `@base-ui/react/button`
- `input.tsx` uses `@base-ui/react/input`
- `separator.tsx` uses `@base-ui/react/separator`
- no `asChild`
- no Radix imports added
- one toast host only via `components/ui/sonner.tsx` mounted from root layout
- dark-mode substrate removed after generation:
  - removed `next-themes`
  - removed `.dark` token block
  - removed `@custom-variant dark`
  - removed dark-only class branches from Task 14-owned components

## Token Choices / Contrast Rationale

- Primary/brand stays deep forest: readable on warm neutral surfaces, distinct from success semantics.
- Surfaces stay warm-neutral: high text contrast for dense finance tables/forms, lower visual noise than green-heavy backgrounds.
- Amber stays restrained: used for focus ring and warning surfaces, not generic highlight everywhere.
- Success/warning/destructive get separate variables and surfaces:
  - `--success`, `--success-surface`, `--success-border`
  - `--warning`, `--warning-surface`, `--warning-border`
  - `--destructive`, `--destructive-surface`, `--destructive-border`
- Touch target baseline set to `--control-height: 2.75rem` = 44px practical minimum.
- No scattered raw hex outside token definitions. No dark mode.

## Extra Compatibility Corrections

These were minimum direct fixes needed to satisfy Task 14 checks against frozen contracts:

| File | Reason |
| --- | --- |
| `apps/web/vitest.config.ts` | generated `@/` imports failed Task 14 RED/GREEN under Vitest without alias resolution |
| `apps/web/features/dashboard/dashboard.tsx` | one raw `.button-secondary` caller renamed; stale `useGetRecentTransactions` call shape fixed for current Orval output |
| `apps/web/tests/transaction-form.spec.tsx` | `TransactionContract` fixtures needed `wallet_name` and `category_name` after Task 13 freeze |

## GREEN / Surrounding Commands

Focused GREEN:

```bash
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH \
pnpm --dir=apps/web exec vitest run tests/design-system.spec.tsx
```

Output:

```text
Test Files  1 passed (1)
Tests       4 passed (4)
```

Surrounding gates:

```bash
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir=apps/web run lint
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir=apps/web run typecheck
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir=apps/web run build
```

Final outputs:

```text
lint: exit 0
typecheck: exit 0
build: exit 0
```

`build` route summary ended with:

```text
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

## Test-Expectation Contradiction Evidence

- Brief command `pnpm --dir apps/web vitest run ...` is stale for this pnpm invocation shape. `--dir=apps/web` plus `exec` is required here.
- `shadcn init --yes` still prompted for preset.
- shadcn help advertises `--defaults` as `base-nova`, but accepted preset names are `nova|vega|maia|lyra|mira|luma|sera|rhea`.

## Self-Review / Concerns

- Task 14 intentionally leaves `form-field`, `dialog`, native selects, native textarea, confirm-box patterns, and `.button` link compatibility in place for later slice migrations. Inventory doc tracks those deferrals.
- `globals.css` now carries both design tokens and temporary compat selectors. Task 24 should delete leftover compat selectors once Tasks 15–23 finish migrations.
- Generator added broad lockfile churn. Required, but review should focus on `apps/web` dependency additions tied to Tailwind/Base UI/shadcn/Sonner.
