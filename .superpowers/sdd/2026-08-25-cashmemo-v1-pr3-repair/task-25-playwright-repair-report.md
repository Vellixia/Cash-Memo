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

## Fix round 1/5: independent Important-finding repair

Recorded: 2026-08-31, Asia/Jakarta (WIB). Runtime: Node `v24.14.0`, pnpm `11.13.1`, Chromium.

### Root cause and minimal repair

1. `apps/web/e2e/wallets-categories.spec.ts` `chooseOption` proved only that a Base UI portal
   option was clicked and the popup closed. It did not prove controlled form-state synchronization.
   Recurring wallet/category triggers deliberately expose their stable IDs rather than display text,
   so a trigger-text-only assertion would be invalid. The helper now reopens the visible listbox,
   requires the named option to have `selected: true`, then closes it. This proves current selected
   option state for every helper use (budget category/currency and recurring wallet/category/
   frequency) without production changes.

2. `apps/web/e2e/cache-isolation.spec.ts` had removed Task 23's held `/login` navigation. It then
   waited for login render before checking History abort, allowing navigation commit/unmount to
   cancel the mounted production History query independently of logout cleanup. The repair holds
   actual `/login` delivery after the successful real logout response, waits for that navigation to
   start, requires the exact held History request to emit `failed` while `Loading transactions…`
   remains mounted, then releases login navigation and continues same-page User B isolation checks.
   No production change was required.

### Baseline, RED mutations, and GREEN

Baseline weak tests passed before repair:

```text
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH \
  pnpm --dir apps/web exec playwright test e2e/wallets-categories.spec.ts e2e/cache-isolation.spec.ts --workers=1
3 passed
```

Selection mutation RED temporarily changed the real recurring frequency handler from
`setFrequency(value)` to `setFrequency("daily")`, while selecting `Weekly`:

```text
pnpm --dir apps/web exec playwright test e2e/wallets-categories.spec.ts --grep 'edits opening balance' --workers=1
1 failed
Locator: locator('[data-slot="select-content"]:visible').getByRole('option', { name: 'Weekly', exact: true, selected: true })
Expected: visible
Error: element(s) not found
```

The page snapshot showed `combobox "Frequency" [expanded]: daily` and `option "Daily"
[selected]`. Restoring `setFrequency(value)` followed by
`pnpm --dir apps/web exec playwright test e2e/wallets-categories.spec.ts --workers=1` produced
`2 passed`.

Logout-cleanup mutation RED temporarily removed `clearSessionState(client)` from the shared
`CurrentSessionSignOut` success path:

```text
pnpm --dir apps/web exec playwright test e2e/cache-isolation.spec.ts --workers=1
1 failed
logout cleanup must abort held History request before held login navigation commits
Expected: "failed"
Received: undefined
Timeout 5000ms exceeded while waiting on the predicate
```

Restoring the cleanup then produced focused GREEN:

```text
pnpm --dir apps/web exec playwright test e2e/wallets-categories.spec.ts e2e/cache-isolation.spec.ts --workers=1
3 passed
```

### Fresh validation

`pnpm toolchain:check` passed (`node=24.14.0`, `pnpm=11.13.1`). One default four-worker Playwright
attempt had unrelated 60-second E2E timeouts across four specifications, and one default Vitest
attempt had two unrelated 5-second test-worker timeouts. Fresh single-worker retries passed; this
report records the parallel attempts as timing failures rather than treating them as verification.

```text
pnpm --dir apps/web exec playwright test --workers=1
15 passed

pnpm --dir apps/web test --run --maxWorkers=1
Test Files  18 passed (18)
Tests  181 passed (181)
```

Fresh `pnpm --dir apps/web lint`, `pnpm --dir apps/web typecheck`, and
`pnpm --dir apps/web build` passed. `git diff --check` passed. Final production source diff is
empty; only the two E2E proof repairs and this evidence report are intended changes.
