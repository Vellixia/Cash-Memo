# Task 25 Playwright repair report

Status: PASS (Playwright repairs verified; production/image gates remain outside this repair)

Recorded: 2026-08-30, Asia/Jakarta (WIB)

Implementation under test: `d733b13dd7fdc171ab11f9f2d52e503a3ca8350a` on `rewrite/cashmemo-v1`.

## Scope and clean-stack method

Inspected Docker state first. Removed only the named default disposable `v1` project with:

```bash
docker-compose -f infra/v1/test-compose.yml down --volumes --remove-orphans
```

Each focused and full Playwright invocation then started PostgreSQL/Mailpit only through
`apps/web/playwright.config.ts` → `e2e/support/start-api.mjs`. Unrelated `cairn-*` containers
were not touched. Runtime used Node `v24.14.0`, pnpm `11.13.1`, Chromium.

## Root-cause investigation and classification

All five reported failures reproduced from the pre-repair report, then passed after minimal E2E
expectation/stability repairs. No product source change was justified.

1. Accessibility detached-DOM/budget timing — **test flake / readiness contradiction**.
   Old expectation called `scrollIntoViewIfNeeded()` immediately after the page heading, while
   budget options were still replacing form DOM. Corrected expectation waits for budget loading and
   error states to clear, requires the target control visible, and retries only the observed
   `Element is not attached to the DOM` race before focus/geometry checks. Regression protected:
   keyboard focus remains above fixed mobile navigation and no horizontal overflow is asserted.

2. Auth/onboarding wallet summary — **test contradiction**.
   Old expectation searched for `USD · Balance 1000.00`, which belonged to the prior wallet card.
   Approved Task 20–24 UI renders exact `MoneyAmount` text (`USD 1,000.00`) plus
   `Opening balance 1000.00` inside the wallet article. Corrected expectation scopes assertions to
   the matching wallet article and waits for the dialog animation before measuring the 44px field.
   Regression protected: wallet identity, exact amount/opening balance, dialog semantics, and
   touch-target geometry.

3. Transactions amount heading — **test contradiction**.
   Old expectation required headings named `Expense 12.34 USD` / `Income 250.00 USD`.
   Approved compact transaction rows expose article semantics and exact `MoneyAmount` strings
   (`USD 12.34`, `USD 250.00`) rather than heading semantics. Corrected expectation scopes each
   note to its article and checks type, exact amount, and note. Regression protected: expense/income
   identity and displayed amount cannot cross rows.

4. Wallets/categories native option — **test contradiction**.
   Old expectation used `selectOption()` against a native `<select>` and expected a Food & Drink
   `<option>`. Approved Base UI Select renders a `combobox` and portal `role=option` listbox.
   Corrected helper opens the current Base UI content, selects exact visible option names, waits for
   portal close, and retries only detached-portal races. Regression protected: category/currency,
   wallet/category, and frequency values are selected through user-visible semantics.

5. Category-created permanent status — **test contradiction**.
   Old expectation required permanent `role=status` text `Category created`. Approved Sonner success
   feedback is transient; category creation's durable behavior is dialog closure and rendered list
   item. Corrected expectation waits for the named dialog to hide and matching category article to
   become visible, then verifies archive lifecycle. Regression protected: created category appears,
   can be archived, and is excluded from active choices.

## RED/GREEN evidence

Pre-repair Task 25 clean rerun recorded the five failures above. Repairs changed only E2E assertions
and synchronization; no production files changed. Fresh post-repair focused runs were green:

| Spec | Result |
| --- | ---: |
| `e2e/auth-onboarding.spec.ts` | 3/3 |
| `e2e/transactions.spec.ts` | 2/2 |
| `e2e/wallets-categories.spec.ts` | 2/2 |
| `e2e/accessibility.spec.ts` | 2/2 |
| Full `pnpm --dir apps/web exec playwright test` | 15/15 |

Supporting checks: web Vitest `18` files / `181` tests passed; `pnpm lint` passed;
`pnpm typecheck` passed; `pnpm build` passed.

## Cleanup and limitations

After verification, default disposable `v1` services were removed with the exact compose down
command above. No unknown Docker project was removed. This report proves local E2E behavior only;
it does not claim production deployment, backup/restore, image Trivy, or production readiness.
