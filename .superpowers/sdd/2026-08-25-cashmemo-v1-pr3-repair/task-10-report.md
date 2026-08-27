# Task 10 evidence report: exact monetary output invariant

## Status

Implemented. Signed commit required by brief. Base SHA:
`43bb7831c15e9b6bf6efc11d3b545b1019c8f5af`. Final SHA is the signed commit containing this
report and the listed changes; exact SHA is returned in task handoff.

Branch verified: `rewrite/cashmemo-v1`. Tracked tree was clean before work. Untracked `.serena/`
was present, reported, and not touched.

## Files changed

- `apps/api/src/money.rs`
- `apps/api/src/wallets/service.rs`
- `apps/api/src/transactions/service.rs`
- `apps/api/src/budgets/service.rs`
- `apps/api/src/reporting/query.rs`
- `apps/api/tests/money.rs`
- `apps/api/tests/wallets.rs`
- `apps/api/tests/budgets.rs`
- `apps/api/tests/reporting.rs`
- `docs/verification/v1-pr3-repair-evidence.md`
- `.superpowers/sdd/2026-08-25-cashmemo-v1-pr3-repair/task-10-report.md`

No generated files changed.

## RED evidence

Added named tests:

- `exact_formatter_normalizes_trailing_zeroes_without_rounding`
- `exact_formatter_rejects_corrupt_scale`
- `exact_formatter_preserves_valid_negative_net`
- `percentage_formatter_rounds_to_two_decimal_places_explicitly`
- `wallet_read_rejects_persisted_corrupt_scale_instead_of_rounding`
- `budget_read_rejects_persisted_corrupt_scale_instead_of_rounding`
- `monthly_summary_rejects_persisted_corrupt_scale_instead_of_rounding`

Command:

```text
cargo test -p cashmemo-api --test money -- --nocapture
```

Exact failure before implementation:

```text
error[E0432]: unresolved imports `cashmemo_api::money::format_exact_for_exponent`, `cashmemo_api::money::format_percentage_2dp`
no `format_percentage_2dp` in `money`
no `format_exact_for_exponent` in `money`
```

This was the intended feature-missing RED. The required combined command also compiled after the
test-harness correction, but DB-backed tests stopped at the environment prerequisite:

```text
cargo test -p cashmemo-api --test money --test wallets --test budgets --test reporting -- --nocapture
DATABASE_URL must be set: EnvVar(NotPresent)
```

## Implementation

`format_exact_for_exponent(Decimal, u32)` validates exponent, normalizes the decimal, rejects
normalized scale greater than exponent with `MoneyError::ExcessScale`, then rescales only for
zero-padding. Wallet, transaction, budget, and reporting authoritative output paths use this
helper and map corrupt persisted values to their existing persistence/internal error path.

`format_percentage_2dp` remains separate and uses
`RoundingStrategy::MidpointAwayFromZero`. Budget progress and reporting category shares call this
presentation-only helper. Authoritative money paths contain no `round_dp` formatter.

Budget persisted-value validation also compares normalized scale directly, avoiding rounding while
checking an existing amount.

## GREEN and surrounding verification

```text
cargo fmt --all -- --check
```

Passed.

```text
cargo test -p cashmemo-api --lib
```

Passed: 8 tests.

```text
cargo test -p cashmemo-api --test money exact_formatter -- --nocapture
```

Passed: 3 exact formatter tests; 11 filtered.

```text
cargo test -p cashmemo-api --test wallets --test budgets --test reporting --no-run
```

Passed: all three DB-backed targets compiled.

```text
cargo test -p cashmemo-api
```

Library tests passed; DB-backed test binaries stopped because `DATABASE_URL` was unset. No local
DB was started or mutated.

## Tests changed due to contradicted spec

None. Existing percentage and exact-string expectations already matched approved design. New tests
add the previously unprotected corrupt-persistence and formatter invariants; no prior expectation
was weakened or rewritten.

## Self-review

- Normalization occurs before scale comparison, so `1.2300` becomes `1.23` while `1.231` at
  exponent 2 fails closed.
- Rescaling occurs only after validation; authoritative values never round.
- Negative net values preserve sign and exact scale.
- Percentage rounding is explicit and isolated from money formatting.
- Wallet, transaction, budget, monthly summary, and recent transaction serializers route through
  shared exact formatting.
- Existing API error mapping remains generic persistence/internal failure and does not expose DB
  details.
- `.serena/` was not read, edited, staged, or removed.

## Concerns

- DB-backed RED/GREEN endpoint tests could not execute in this workspace because `DATABASE_URL` is
  unset. CI or a disposable test database must run the required command before merge.
- `cargo clippy -p cashmemo-api --all-targets -- -D warnings` remains blocked by two pre-existing
  unrelated `new_without_default` findings in `apps/api/src/accounts/deletion.rs` and
  `apps/api/src/accounts/routes.rs`; `cargo check -p cashmemo-api` passes.
- `MoneyError::ExcessScale` is reused for corrupt persisted scale; no new public error variant was
  needed because callers intentionally map it to persistence failure.
