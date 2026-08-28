# Cashmemo V1 PR3 Task 14 UI Primitive Inventory

Date: 2026-08-27
Branch: `rewrite/cashmemo-v1`
Base/starting SHA: `d336ac812adb56b5485f58502d48cd83609361d0`
Pinned CLI source: `pnpm view shadcn version --json`
Pinned CLI version: `4.19.0`

## Inventory Commands

```bash
rg -n 'components/ui/(button|input|dialog|form-field)|<select\b|className=.*button-|className=.*input|confirm\(' apps/web --glob '!generated/**'
rg -n '^\.button-|^\.input|\[role="dialog"\]|aria-modal' apps/web --glob '*.{css,tsx}'
rg -n '<select\b|confirm-box|button-primary|button-secondary|button-danger|button-quiet|className=\"[^\"]*(button|input)' apps/web
```

## Legacy Surface

| Surface | Paths / consumers | Classification | Owner |
| --- | --- | --- | --- |
| `components/ui/button.tsx` legacy wrapper | imported by auth, onboarding, wallets, categories, budgets, recurring, transactions, settings, deletion pages | replace now with Base UI-backed compat API | Task 14 |
| `components/ui/input.tsx` legacy wrapper | imported by auth, wallets, categories, budgets, recurring, transactions, settings | replace now with Base UI-backed compat API | Task 14 |
| `components/ui/form-field.tsx` | imported by auth, onboarding, wallets, categories, budgets, recurring, transactions, settings, tests | retain for now; still needed by current slices; future field integration deferred | Tasks 15–23 |
| `components/ui/dialog.tsx` | superseded homemade wrapper | removed; generated Base UI Dialog adopted by Task 20 | Task 20 |
| Native `<select className="input">` | onboarding, recurring form, budgets, categories, wallets, transaction form/filters, preferences | retain with compat CSS; migrate to Base UI controls later | Tasks 16–23 |
| Native `<textarea className="input">` | transaction form | retain with compat CSS; migrate later | Task 18 |
| Raw `.button` link/button styling | transaction history links, dashboard retry button | retain base compat class; remove variant subclasses now | Tasks 14, 19 |
| Raw `.button-primary/.button-secondary/.button-danger/.button-quiet` selectors | only in old `globals.css`; dashboard retry button used `.button-secondary` | remove now; no consumer left after dashboard rename | Task 14 |
| Raw `.input` selector | old `globals.css` plus legacy `Input` wrapper | remove exact selector now; replace with non-shadcn native-control compat selectors | Task 14 |
| Homemade confirm boxes | categories, wallets, budgets, recurring, transactions trash/history | retain markup/CSS for now; modal/alert-dialog migration deferred | Tasks 19–21 |

## Generated Foundation Added In Task 14

| File | Source | Notes |
| --- | --- | --- |
| `apps/web/components.json` | `shadcn init` | source of generator truth; alias `@/components/ui`; CSS vars on |
| `apps/web/lib/utils.ts` | `shadcn init` | `cn()` helper for generated components |
| `apps/web/components/ui/button.tsx` | `shadcn init`, then compat theming | Base UI-backed via `@base-ui/react/button`; supports existing `primary/secondary/quiet/danger` callers |
| `apps/web/components/ui/input.tsx` | `shadcn add input --overwrite --yes` | Base UI-backed via `@base-ui/react/input`; 44px minimum target |
| `apps/web/components/ui/card.tsx` | `shadcn add` | first-foundation card |
| `apps/web/components/ui/label.tsx` | `shadcn add` | first-foundation label |
| `apps/web/components/ui/separator.tsx` | `shadcn add` | Base UI-backed separator |
| `apps/web/components/ui/skeleton.tsx` | `shadcn add` | first-foundation loading primitive |
| `apps/web/components/ui/sonner.tsx` | `shadcn add`, then no-dark customization | single toast host; light-only |

## Substrate Audit

- Interactive generated primitives are Base UI-backed, not Radix-era snippets:
  - `button.tsx` imports `@base-ui/react/button`
  - `input.tsx` imports `@base-ui/react/input`
  - `separator.tsx` imports `@base-ui/react/separator`
- No `asChild` composition added.
- No parallel second button/input implementation introduced.
- `dialog`, `field`, `select`, `textarea`, `combobox`, `alert-dialog`, `tabs`, `progress`, and sidebar remain deferred until their first consumer tasks.

## Direct Compatibility Corrections Outside Brief File List

| File | Why |
| --- | --- |
| `apps/web/vitest.config.ts` | generated `@/` imports need alias resolution in Vitest to run Task 14 RED/GREEN |
| `apps/web/features/dashboard/dashboard.tsx` | renamed one raw `button-secondary` consumer and fixed stale `useGetRecentTransactions` call shape surfaced by frozen Orval contracts |
| `apps/web/tests/transaction-form.spec.tsx` | added newly required `wallet_name` / `category_name` fixture fields so Task 14 `typecheck`/`build` can pass against frozen contract types |

## Deferred Removes

- `components/ui/form-field.tsx`
- native selects / textarea
- confirm-box patterns
- `.button` link compatibility class

Those remain intentionally until Tasks 15–23 migrate actual consumers.

---

# Cashmemo V1 PR3 Task 15 Update (Auth Flows)

Date: 2026-08-28
Branch: `rewrite/cashmemo-v1`
Base/starting SHA: `cd97dc2aeb211106173eac69c1a41e73818929ed`
Pinned CLI version: `4.19.0` (unchanged; `apps/web` devDependency)

## Generated Foundation Added In Task 15

| File | Source | Notes |
| --- | --- | --- |
| `apps/web/components/ui/field.tsx` | `pnpm exec shadcn add field alert --yes` | first consumer: auth forms + deletion form; `FieldError` renders `role="alert"` and links to the control through `aria-describedby` |
| `apps/web/components/ui/alert.tsx` | `pnpm exec shadcn add field alert --yes` | first consumer: auth page-state panels; success/accepted panels override `role="status"` |

`shadcn add` reported `Skipped 2 files: components/ui/label.tsx, components/ui/separator.tsx`
(identical to the Task 14 output, not overwritten).

## Post-generation Corrections Inside Generated Files

| File | Change | Why |
| --- | --- | --- |
| `apps/web/components/ui/field.tsx` | `Array<T>` → `T[]` | repo ESLint `@typescript-eslint/array-type` with `--max-warnings 0` |
| `apps/web/components/ui/field.tsx` | `uniqueErrors?.length == 1` → `uniqueErrors.length === 1` | repo ESLint `@typescript-eslint/no-unnecessary-condition` |

Both generated files are left in the formatting the CLI emitted, matching the Task 14 precedent
(every Task 14 `components/ui/*.tsx` file also fails repo-wide `pnpm format:check`).

## Legacy Surface Retired By Task 15

| Surface | Previous consumers | Status after Task 15 |
| --- | --- | --- |
| `components/ui/form-field.tsx` | auth forms, onboarding, wallets, categories, budgets, recurring, transactions, settings | no longer used by auth or the deletion screen; still used by Tasks 16–23 surfaces, so the file stays |
| `.auth-form` and `.auth-links` CSS blocks in `app/globals.css` | `.auth-form`: auth forms only; `.auth-links`: the five public auth pages | both now dead CSS; removal deferred because `globals.css` is Task 14/16 territory and `.dialog`, which shares the `.auth-form` rule, still has many consumers |
| Raw `<label>` + `<input>` in `app/(auth)/deletion/page.tsx` | deletion screen | replaced by `Field`/`FieldLabel` + `Input` |
| `.dialog .deletion-card` markup on the deletion screen | deletion screen | replaced by `Card`; the CSS classes remain for onboarding/settings/forms consumers |

## Substrate Audit

- `field.tsx` composes the existing Base UI-backed `Label` and `Separator`; it adds no second label
  or separator implementation.
- `alert.tsx` is presentational only (no interactive substrate), so it introduces no Radix-era
  primitive.
- No `asChild` composition added. Auth headings are rendered as real `<h1>` elements carrying
  `data-slot="card-title"` because the generated `CardTitle` is a `div` and public pages need one
  document heading.
- `dialog`, `select`, `textarea`, `combobox`, `alert-dialog`, `tabs`, `progress`, and sidebar remain
  deferred to their first consumer tasks.

## Direct Corrections Outside The Task 15 Brief File List

| File | Why |
| --- | --- |
| `apps/web/next.config.ts` | required by brief step 8 (`Referrer-Policy: no-referrer` for `/verify-email` and `/reset-password`) |
| `apps/web/app/globals.css` | `a:focus-visible` (and control focus) set `outline: none` with only a box-shadow ring, so the Task 14 design system failed the keyboard-focus assertion in `e2e/auth-onboarding.spec.ts`; replaced with a real `2px` outline plus the existing ring |
| `apps/web/e2e/support/auth.ts`, `apps/web/e2e/support/mailbox.ts` | the two named E2E specs consume the shared register/verify/mailbox helpers; the fragment-token flow lives there |
| `docs/verification/v1-pr3-ui-primitive-inventory.md` | brief step 13 (controller-authorised) |

---

# Cashmemo V1 PR3 Task 16 Update (Responsive shell and onboarding)

Date: 2026-08-28
Branch: `rewrite/cashmemo-v1`
Base/starting SHA: `abbd48cffe7a3b30539bc7a2734bb18b07888969`
Pinned CLI version: `4.19.0` (unchanged; `apps/web` devDependency)

## Generated Foundation Added In Task 16

| File | Source | Notes |
| --- | --- | --- |
| `apps/web/components/ui/sheet.tsx` | interrupted worker output from `pnpm exec shadcn add sheet combobox` | Base UI `@base-ui/react/dialog` substrate; adopted for mobile `More` sheet |
| `apps/web/components/ui/combobox.tsx` | interrupted worker output from `pnpm exec shadcn add sheet combobox` | Base UI `@base-ui/react` combobox substrate; adopted for exact-IANA timezone search |
| `apps/web/components/ui/input-group.tsx` | dependency emitted with generated combobox | required by generated `ComboboxInput` |
| `apps/web/components/ui/textarea.tsx` | dependency emitted with generated combobox | required by generated `input-group`; no task-local behavior changes |

No regeneration/version change was needed. Partial generated files were audited in place and kept.

## Sidebar YAGNI Ruling

| Option | Ruling | Why |
| --- | --- | --- |
| shadcn `sidebar.tsx` primitive | rejected for Task 16 | Cashmemo only needs one static desktop nav, one route-driven Add link, and one mobile overflow sheet. Generated Sidebar provider/menu/collapse/resizable/workspace patterns would add extra state and substrate without simplifying this information architecture. |
| existing semantic shell nav + generated `sheet` | retained | smaller diff, exact labels/routing, no second navigation framework, and direct satisfaction of desktop/mobile parity plus restricted-shell isolation |

## Substrate Audit

- `sheet.tsx` is Base UI-backed via `@base-ui/react/dialog`; it adds no Radix-era or local dialog
  implementation.
- `combobox.tsx` is Base UI-backed and keeps searchable option semantics for exact IANA values.
- `input-group.tsx` composes the existing Base UI-backed `Button`, `Input`, and generated
  `Textarea`; no duplicate control substrate added.
- No `asChild` composition added.
- One icon system only: Lucide in shell + onboarding.
- No shadcn Sidebar primitive generated or introduced after the YAGNI review.

## Legacy Surface Retired By Task 16

| Surface | Previous consumers | Status after Task 16 |
| --- | --- | --- |
| onboarding category-seeding step/UI | `apps/web/features/onboarding/*`, onboarding tests, onboarding E2E helper | removed from visible onboarding flow; backend reconciliation remains authoritative and invisible |
| `History` shell vocabulary | desktop/mobile shell, focused tests, onboarding/auth E2E | renamed to `Transactions`; desktop and mobile IA now match approved vocabulary |
| horizontally scrolling bottom-nav strip | mobile shell CSS | replaced with fixed five-slot grid plus safe-area content inset and sheet overflow |
| onboarding timezone `datalist` | onboarding flow | replaced by generated searchable combobox with exact IANA selection |

## Direct Corrections Outside The Task 16 Brief File List

| File | Why |
| --- | --- |
| `apps/web/e2e/support/auth.ts` | onboarding helper had to drop the obsolete visible category step and select the combobox timezone option by accessible role |
| `apps/web/e2e/auth-onboarding.spec.ts` | desktop label/focus assumptions changed with `Transactions` rename and route-driven Add placement; focused mobile `More` sheet verification added |
| `docs/verification/v1-pr3-ui-primitive-inventory.md` | brief step 12/13 controller requirement |

## Follow-up Fix Round 1 (2026-08-28)

| Surface | Change | Why |
| --- | --- | --- |
| `/app` auth layout import boundary | added `apps/web/components/full-access-app-shell.tsx` wrapper with `next/dynamic` shell load | restricted `/app` sessions must redirect before `AppShell` code imports or mounts |
| onboarding currency registry pending/error UX | explicit loading `status`, retryable error `alert`, disabled input until registry recovers | pending/error registry state is not user validation; client must wait for authoritative server registry |
| focused regressions | added `/app` layout module-graph test plus onboarding currency pending/error/recovery tests | preserves restricted-shell isolation and durable onboarding accessibility after repair |

# Cashmemo V1 PR3 Task 17 Update (Currency-separated dashboard and exact money)

Date: 2026-08-28
Branch: `rewrite/cashmemo-v1`
Base/starting SHA: `22a3d1ef360fbd9cbdc3498e3b4ce5d6792e4194`
Pinned CLI version: `4.19.0`

## Generated Foundation Added In Task 17

| File | Source | Notes |
| --- | --- | --- |
| `apps/web/components/ui/progress.tsx` | `pnpm --dir apps/web exec shadcn add progress` | Generated Base UI `@base-ui/react/progress` primitive; first consumer is dashboard category share and budget progress |

## Task 17 Substrate Audit

- `Progress` remains the single generated Base UI-backed progress substrate; no native progress or Radix-era wrapper was added.
- `MoneyAmount` is presentational and delegates exact string validation/grouping to `components/money/exact-decimal.ts`.
- No Orval-generated files were edited.

## Task 17 Composition Changes

| Surface | Change | Why |
| --- | --- | --- |
| Dashboard month | `?month=YYYY-MM` state updates monthly summary, budget summary, and recent transactions together | backend owns month/query semantics |
| Currency sections | summary and budget sections are grouped independently by currency | no cross-currency hero total, scale, or context |
| Category composition | proportional bars consume server `share_percent` only; displayed percentage stays canonical string | avoids client financial math |
| Loading/error/empty | stable Skeleton regions plus local endpoint errors; no-activity and no-budget copy remain distinct | preserves successful sibling sections |
| Money | canonical signed decimal digits grouped as strings; direction is explicit text and accessible label | no rounding/recalculation or color-only meaning |

# Cashmemo V1 PR3 Task 18 Update (Route-driven transaction form and timezone round trip)

Date: 2026-08-28
Branch: `rewrite/cashmemo-v1`

## Generated Foundation Added In Task 18

| File | Source | Notes |
| --- | --- | --- |
| `apps/web/components/ui/select.tsx` | `pnpm exec shadcn add select radio-group --yes` | Generated Base UI `@base-ui/react/select` primitive; first consumers are transaction wallet/category controls |
| `apps/web/components/ui/radio-group.tsx` | `pnpm exec shadcn add select radio-group --yes` | Generated Base UI `@base-ui/react/radio` + `@base-ui/react/radio-group`; first consumer is transaction direction control |
| `apps/web/components/ui/textarea.tsx` | Task 16 generated foundation | Reused unchanged; no regeneration |

## Task 18 Substrate Audit

- Transaction form uses one Base UI Select substrate for wallet/category and one Base UI RadioGroup substrate for direction.
- Existing Base UI Textarea remains single implementation; no native transaction textarea/select fork remains.
- No Orval-generated files edited.

## Legacy Surface Retired By Task 18

| Surface | Status after Task 18 |
| --- | --- |
| Native transaction wallet/category selects | replaced by Base UI Select with keyboard options and linked field errors |
| Native transaction direction select | replaced by accessible Expense/Income segmented RadioGroup |
| Browser-timezone `occurred_at` payload conversion | removed; create writes `occurred_local`, untouched edit omits it |
| `/app/transactions/{id}` detail-as-edit route | removed; canonical edit is `/app/transactions/{id}/edit` |

# Cashmemo V1 PR3 Task 19 Update (Compact history, filters, Trash)

Date: 2026-08-28
Branch: `rewrite/cashmemo-v1`
Pinned CLI version: `4.19.0`

## Generated Foundation Added In Task 19

| File | Source | Notes |
| --- | --- | --- |
| `apps/web/components/ui/dropdown-menu.tsx` | `pnpm exec shadcn add dropdown-menu` | Base UI Menu substrate; transaction secondary actions |
| `apps/web/components/ui/alert-dialog.tsx` | `pnpm exec shadcn add alert-dialog` | Base UI Dialog substrate; permanent Trash deletion only |
| `apps/web/components/ui/badge.tsx` | `pnpm exec shadcn add badge` | Presentational outline badge for Future/Trash state |

Generator prompted on existing `button.tsx`; answered no and preserved Task 14 Button. No duplicate
substrate or Radix-era primitive introduced.

## Task 19 Substrate Audit

- Existing Task 16 Sheet reused for mobile filter drafts and one Apply/Clear commit.
- DropdownMenu and AlertDialog are generated Base UI primitives; no raw menus/dialogs added.
- Compact rows delegate exact display to `MoneyAmount`; direction and Future/Trash states are text and badges.
- No Orval-generated files edited.

# Cashmemo V1 PR3 Task 20 Update (Wallet and category management)

Date: 2026-08-28
Branch: `rewrite/cashmemo-v1`
Pinned CLI version: `4.19.0`

## Generated Foundation Added In Task 20

| File | Source | Notes |
| --- | --- | --- |
| `apps/web/components/ui/dialog.tsx` | `pnpm -C apps/web exec shadcn add dialog` | Generated Base UI Dialog; wallet/category forms and restrained archive confirmations |
| `apps/web/components/ui/tabs.tsx` | `pnpm -C apps/web exec shadcn add dialog tabs` | Generated Base UI Tabs; one Expense/Income category level |

The CLI prompted on existing `button.tsx`; answer was no, preserving Task 14 Button. Homemade
Dialog wrapper is superseded. DropdownMenu, AlertDialog, Badge, and MoneyAmount remain shared.

## Task 20 Substrate Audit

- Wallet/category actions use generated Base UI DropdownMenu, Dialog, AlertDialog, and Tabs.
- Opening-balance edits send exact strings and invalidate wallet scopes only; currency stays read-only.
- Archive invalidates dependent entry-default and recurring queries; restore never resumes rules.
- Server remains authoritative for hard-delete conflicts; no client eligibility inference added.
- Embedded management forms deliberately omit the standalone `.dialog` surface so generated Dialog
  owns the single border/background/shadow/padding surface; archive errors remain inside their
  consequence Dialog focus trap and category panels pair generated Tabs triggers with tabpanels.
- No Orval-generated files edited.
