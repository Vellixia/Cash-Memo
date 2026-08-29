# Cashmemo V1 PR3 visual and accessibility review

Run: 2026-08-30, local disposable V1 stack, Chromium, `@axe-core/playwright` **4.13.0**.
All fixtures use `example.test` addresses and synthetic names/notes. Captures are ignored local
evidence under `apps/web/test-results/`; they are not pixel-diff gates or public artifacts.

Captured at each exact viewport: `375x812`, `768x1024`, `1280x800`, `1440x900`. The evidence
directory below is from the final GREEN run; `history-long-scroll` is the required long-content
scroll state. Every final capture was inspected with the image viewer.

| Screen | Viewport | Evidence | Finding | Disposition |
| --- | --- | --- | --- | --- |
| Login validation | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/login-validation.png` | Validation hierarchy, focus ring, warm neutral surface, and green primary action remain legible. | Accepted; no change required. |
| Onboarding timezone | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/onboarding-timezone.png` | Long IANA input and helper copy wrap without clipping; save target remains reachable. | Accepted; no change required. |
| Dashboard dense multi-currency | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/dashboard-dense-multi-currency.png` | Initial review showed metric value overlap at 768px and 1280px. | Fixed individually with 2-column metrics through 1300px and 1-column metrics through 900px; rendered Playwright geometry RED/GREEN and final recapture. |
| New transaction validation | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/new-transaction-validation.png` | 375px form is intentionally scrollable; save action starts below fixed nav in top frame but remains reachable. | Accepted; browser assertion focuses/scrolls save above nav and verifies safe-area padding/no overflow. |
| History filters | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/history-filters-crowded.png` | Mobile Sheet focus, date controls, apply/clear hierarchy, and desktop filter density are clear. | Accepted; no change required. |
| History long scroll | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/history-long-scroll.png` | Long synthetic names/notes wrap; action buttons stay visible and cards do not create horizontal overflow. | Accepted; no change required. |
| Wallets active/archived | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/wallets-active-archived.png` | Initial 375px cards were narrowed by hidden sidebar grid track. | Fixed individually by collapsing mobile `.app-shell` to one track; rendered Playwright shell/row geometry RED/GREEN and final recapture. |
| Budgets over 100% / negative | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/budgets-over-100-negative.png` | Over-budget red border, textual status, 12346.58% value, and negative remaining remain explicit; mobile form is long-scroll content. | Accepted after mobile shell fix; no color-only meaning. |
| Recurring active/paused/future | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/recurring-active-paused-future.png` | Status text/icons and future dates remain visible; mobile action targets stack safely. | Accepted after mobile shell fix; no change required. |
| Settings | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/settings.png` | Initial captures caught `Opening your journal…` loading state instead of preferences. | Fixed individually by waiting for `Journal preferences` and removing loading status before capture; final recapture inspected. |
| Account deletion destructive | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/account-deletion-destructive.png` | Destructive copy and red schedule action have clear hierarchy; long copy wraps. | Accepted; no change required. |
| Deletion-only grace period | 375x812, 768x1024, 1280x800, 1440x900 | `apps/web/test-results/**/visual-review/{375x812,768x1024,1280x800,1440x900}/deletion-only-grace-period.png` | Restricted mode has no financial shell; `pending_deletion`, due date, password, cancel, and sign-out remain textual controls. | Accepted; axe check passed and no color-only status. |

## Accessibility evidence

- `e2e/accessibility.spec.ts` runs real `AxeBuilder` on login, dashboard, new transaction, history
  Sheet, settings, account deletion, and deletion-only states; serious/critical violations must be
  empty. No exclusions are used.
- The same suite verifies skip-link focus, Sheet/dialog focus restoration, reduced-motion computed
  durations, 200% effective viewport reflow, no horizontal overflow, heading semantics, keyboard
  reachability above fixed mobile navigation, safe-area padding, and textual status meaning. Fix
  round 1 adds bounded `375x500` focus/scroll checks for long Budget and Recurring forms, including
  the recurring dialog primary action, plus no-overflow assertions.
- The final focused browser sweep passed **3/3**: login axe, authenticated accessibility, and visual
  review. The final visual test asserts exact viewport dimensions/document width before each capture,
  dashboard metric containment/non-collision at `768x1024` and `1280x800`, and mobile shell/row
  containment at `375x812`.

## Fix round 1 behavioral evidence

Temporary mutation RED (restored before final run) proves tests detect regression rather than source
text: mobile `.app-shell` changed to two tracks and failed `hidden sidebar must not create a mobile
grid track` (`Expected: 1`, `Received: 2`); tablet `.summary-grid` changed to three tracks and
failed `dashboard metric columns at 1280px` (`Expected: 2`, `Received: 3`). Restored CSS GREEN
regenerated all 48 captures; dashboard and wallets affected captures were inspected with image
viewer and had no remaining findings.

## Privacy and retention

`CASHMEMO_V1_E2E_PUBLIC_ORIGIN` is rejected before authentication/capture unless hostname is
`localhost`, `127.0.0.1`, or `[::1]`. Playwright trace/screenshot/video use failure retention for
normal tests; visual tests intentionally write screenshots to ignored `apps/web/test-results/`.
CI uploads only `apps/web/test-results/` and `apps/web/playwright-report/` on failure or explicit
`workflow_dispatch` `capture_visual_review=true`, pinned to `actions/upload-artifact` v4.6.2 with
7-day retention. No credentials, tokens, production origins, or financial bodies are logged.
