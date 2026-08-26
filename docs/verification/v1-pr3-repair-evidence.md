# Cashmemo V1 PR3 repair evidence

## Account deletion password confirmation

- `cancellation_requires_password_then_revokes_restricted_session_and_clears_cookie` proves a
  deletion-only session cannot cancel with a wrong password; successful cancellation revokes that
  session, expires its cookie, and a new login receives `Full` access.
- `request_rejects_status_changed_after_password_verification_without_full_session` and
  `cancellation_rejects_hash_changed_after_password_verification_without_full_session` pause
  after Argon2 verification. A second PostgreSQL connection changes the user record before the
  transition lock; each transition rejects stale confirmation, preserves the externally changed
  state, and leaves no full-access session.
- `account_deletion_request_clears_session_cookie` proves successful deletion request expires the
  browser session cookie and revokes its token.

## Corrected baseline assertion

- Previous expectation: `concurrent_login_and_deletion_leave_no_live_full_session` required zero
  non-revoked sessions.
- Approved contradiction: when deletion wins the row lock, a concurrent login may legitimately
  create one `DeletionOnly` session.
- Corrected expectation: no surviving session may have `SessionAccess::Full`; a surviving
  `DeletionOnly` session is permitted.
- Protected regression: the race test obtains any concurrent login session and asserts its access
  is not `Full`.

## Verification

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test account_deletion --test auth --test ownership`

Result: 29 tests passed.

## Transaction local-time write contract

- `manual_local_times_use_stored_timezone_and_reject_invalid_inputs` proves Jakarta
  `2026-08-31T23:30` stores as `2026-08-31T16:30:00+00:00`; New York's ambiguous
  `2026-11-01T01:30` chooses earlier `2026-11-01T05:30:00+00:00`; nonexistent,
  seconds, offset, `Z`, and impossible inputs return `422`.
- Same test proves omitted create uses server `Utc::now()` and omitted update preserves exact
  stored instant.
- `entry_defaults_select_only_most_recent_active_wallet_for_authenticated_user` asserts exact
  defaults shape: `last_used_wallet_id` plus stored IANA `timezone`, with no server local time.

## Transaction time verification

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test transactions --test ownership`

Result: 13 tests passed.

## Local-calendar history and reporting contract

- History accepts exact `YYYY-MM-DD` `from` and `to` values as inclusive user-local dates, then
  applies half-open UTC bounds. Jakarta boundary fixtures prove inclusion at local midnight and
  exclusion at next-day midnight; Pacific/Apia's skipped 2011-12-30 resolves to an empty range.
- History and recent transaction reads return current wallet and category names while retaining
  user-scoped joins and stable cursor ordering.
- Monthly summary, selected-month recent transactions, and budget summary share local-calendar
  month boundaries. Reports exclude future transactions.
- Expense-category shares use decimal division, midpoint-away-from-zero rounding, clamping to
  `0.00..100.00`, and an exact two-decimal string representation.

## Local-calendar verification

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test history -- --nocapture`

Result: 6 tests passed.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test reporting -- --nocapture`

Result: 5 tests passed.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test history --test reporting --test budgets`

Result: 16 tests passed.

## Recurrence calendar-anchor resume contract

- Root cause: resume used mutable, clamped `next_due_date` as recurrence origin. A monthly
  Jan-31 rule parked at Feb-29 resumed on Aug-29 instead of Aug-31.
- `first_due_on_or_after` now uses direct daily, weekly, monthly, and yearly arithmetic from
  immutable `start_date`; monthly/yearly candidates clamp only final candidate date.
- `resume_uses_start_date_anchor_after_clamp_without_backfill_or_duplicates` covers a long-paused
  Jan-31 rule with Feb-29 scheduler state, confirms no pause backfill, one resumed occurrence,
  and no duplicate after a second processor run.
- `first_due_on_or_after_jumps_from_immutable_calendar_anchor` covers Jan-31, Jan-30, Feb-29,
  and weekly weekday anchors.

## Recurrence verification

RED:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test recurring -- --nocapture`

Result: expected failure in `resume_uses_start_date_anchor_after_clamp_without_backfill_or_duplicates`:
returned `2026-08-29`; expected `2026-08-31`.

GREEN, repeated for idempotency:

`for run in 1 2 3; do DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test recurring || exit 1; done`

Result: each run passed, 13 tests total.

## Editable wallet opening balance and durable onboarding completion

- Root cause: wallet PATCH exposed only `name`, while migration `0005` installed a trigger that
  rejected every opening-balance change. Onboarding completion was recomputed from complete
  starter categories plus an active wallet, so archived-only accounts could reopen onboarding and
  already-completed accounts did not repair missing starter categories.
- Baseline correction: `updates_name_but_rejects_immutable_currency_and_opening_balance` and
  `rejects_direct_wallet_currency_and_opening_balance_changes` encoded opening-balance
  immutability. Approved repair design section 9 instead requires optional wallet `name` and
  `opening_balance` updates while currency remains immutable. Corrected tests allow exact opening
  balance changes, retain currency rejection, and protect cross-user wallet ownership.
- `0009_wallet_onboarding_repair.sql` additively removes both the obsolete trigger and function,
  adds `users.onboarding_completed_at`, and backfills the same migration timestamp for qualifying
  users with active or archived wallets. A user without any wallet remains incomplete.
- Wallet update locks the owned wallet, reads its currency exponent from the registry, validates
  exact nonnegative decimal input, and updates only supplied wallet fields. The regression proves
  current balance changes while transaction count, monthly report, and budget summary stay exact.
- Onboarding reconciliation seeds every missing normalized starter category once, preserves an
  existing completion timestamp, sets first-wallet completion once, and treats archived-only
  completed accounts as onboarded. Repeated reads create no duplicate starters; no seed version or
  state machine was added.

### Wallet/onboarding verification

RED evidence:

- Required combined RED stopped in migrations because version 9 and
  `onboarding_completed_at` were absent.
- `updates_name_and_opening_balance_without_changing_financial_activity` returned `422`; expected
  `200`.
- `rejects_empty_currency_negative_and_excess_scale_wallet_updates` failed because
  `opening_balance` was an unknown PATCH field instead of a field-level validation path.
- Onboarding reconciliation tests failed because `onboarding_completed_at` did not exist and the
  qualifying derived state returned `categories_seeded: false`.
- Obsolete ownership baseline failed at `wallet opening balance must be immutable` after migration
  0009, proving the exact approved-design contradiction before correction.

GREEN:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test migrations -- --nocapture`

Result: 9 tests passed, including version-9 checksum identity, trigger/function removal, and
active/archived-wallet backfill.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test ownership -- --nocapture`

Result: 7 tests passed, including currency immutability, editable opening balance, and cross-user
ownership constraints.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test wallets --test onboarding --test migrations --test reporting --test transactions`

Result: 38 tests passed: migrations 9, onboarding 7, reporting 5, transactions 6, wallets 11.
