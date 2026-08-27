# Task 11 evidence report: deterministic portable recovery timestamps

## Status

Implemented. Signed commit required by brief; final signed SHA is returned in task handoff.
Base SHA: `488c40894499d59bf31f1a3e93855d601886ae6e`. Branch: `rewrite/cashmemo-v1`.
Tracked tree was clean before work. Untracked `.serena/` was present, is user-owned, and was not
read, edited, staged, or removed.

## Files changed

- `scripts/operations/utc-timestamp.mjs`
- `tests/operations/utc-timestamp.bats`
- `tests/operations/preservation-gate.bats`
- `tests/operations/restore-drill.bats`
- `.github/workflows/v1-ci.yml`
- `docs/verification/v1-pr3-repair-evidence.md`
- `.superpowers/sdd/2026-08-25-cashmemo-v1-pr3-repair/task-11-report.md`

No generated files changed.

## Preflight and toolchain

Commands and results:

```text
git branch --show-current
rewrite/cashmemo-v1

git rev-parse HEAD
488c40894499d59bf31f1a3e93855d601886ae6e

git diff --quiet
tracked-clean
```

Initial `pnpm toolchain:check` correctly stopped on the available Node `22.19.0`:

```text
Toolchain mismatch: node=22.19.0 (expected 24.14.0), pnpm=11.13.1 (expected 11.13.1)
[ELIFECYCLE] Command failed with exit code 1.
```

Repository-pinned Node `24.14.0` was available through mise. Required pre-execution check then
passed:

```text
PATH=/Users/andresholivin/.local/share/mise/installs/node/24.14.0/bin:$PATH pnpm toolchain:check
Toolchain verified: node=24.14.0, pnpm=11.13.1
```

## RED evidence

Added named Bats tests:

- `UTC timestamp adds signed integer seconds to explicit RFC3339 base`
- `UTC timestamp accepts only exact UTC seconds and round-trips dates`
- `UTC timestamp rejects invalid mode and offset arguments`
- `UTC timestamp rejects overflow after checked second addition`
- `UTC timestamp supports now mode with strict UTC seconds output`

Command:

```text
PATH=/Users/andresholivin/.local/share/mise/installs/node/24.14.0/bin:$PATH bats tests/operations/utc-timestamp.bats
```

Exact expected RED result: tests 1, 2, and 5 failed their success assertions; tests 3 and 4
passed rejection assertions. Direct invocation showed the feature-missing failure:

```text
Error: Cannot find module '/Users/andresholivin/.superset/worktrees/f45a348c-5be3-4b46-8564-a934b6d9ee87/andres/phase-rubidium/scripts/operations/utc-timestamp.mjs'
```

## Implementation

`utc-timestamp.mjs` parses exactly one `--base` or `--now` mode and a required
`--offset-seconds` value. Explicit bases must first match
`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/`, then pass finite `Date` parsing and exact
`toISOString().replace('.000Z', 'Z') === input` round-trip validation. Offset text must be a
signed integer and both seconds-to-milliseconds multiplication and final addition must remain
safe, finite integers. Date-range overflow and output outside exact UTC seconds fail closed.
`--now` truncates current time to whole UTC seconds and is only used as fixture convenience.

Preservation and restore fixtures now derive `expires`, stale, and future values with explicit
helper bases and signed offsets. BSD `date -v` calls were removed without skipping recovery
assertions. Recovery CI pins
`actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` with `node-version: 24.14.0` before
Bats, so it does not depend on Ubuntu's preinstalled Node.

## Focused and full verification

Focused GREEN:

```text
PATH=/Users/andresholivin/.local/share/mise/installs/node/24.14.0/bin:$PATH bats tests/operations/utc-timestamp.bats
1..5
ok 1 UTC timestamp adds signed integer seconds to explicit RFC3339 base
ok 2 UTC timestamp accepts only exact UTC seconds and round-trips dates
ok 3 UTC timestamp rejects invalid mode and offset arguments
ok 4 UTC timestamp rejects overflow after checked second addition
ok 5 UTC timestamp supports now mode with strict UTC seconds output
```

Focused recovery suites:

```text
PATH=/Users/andresholivin/.local/share/mise/installs/node/24.14.0/bin:$PATH bats tests/operations/utc-timestamp.bats tests/operations/preservation-gate.bats tests/operations/restore-drill.bats
1..19
19 tests passed
```

Required full command:

```text
PATH=/Users/andresholivin/.local/share/mise/installs/node/24.14.0/bin:$PATH bats tests/operations/*.bats tests/repository/*.bats
1..44
44 tests passed
```

## Workflow review

Recovery job contains setup-node immediately after checkout and before Bats installation and
execution, with exact required SHA
`820762786026740c76f36085b0efc47a31fe5020` and `node-version: 24.14.0`. No recovery step relies
on an Ubuntu-provided Node binary.

## Changed-test contradiction evidence

None. Existing preservation and restore assertions retain their original meanings and all still
pass. Only timestamp generation changed from BSD-specific `date -v` calls to equivalent helper
calculations. No recovery assertion was skipped, weakened, or deleted.

## Self-review

- Strict grammar runs before `Date` parsing; round-trip rejects impossible calendar dates and
  normalization.
- Millisecond conversion and addition use safe-integer and finite-result checks; Date range and
  final format are checked before output.
- Conflicting modes, duplicate arguments, missing values, malformed/noninteger offsets, missing
  `Z`, milliseconds, and overflow are rejected.
- Explicit fixture bases are derived once from `--now`, then all test offsets use explicit
  `--base`; no BSD `date -v` calls remain in changed fixtures.
- Workflow pin is exact and placed before Bats.
- `.serena/` remains untouched.

## Concerns

- Local mise cannot activate its configured pnpm asset on this macOS host, so commands used the
  existing pnpm `11.13.1` binary with the mise Node `24.14.0` directory first in `PATH`.
- `--now` is inherently wall-clock dependent, but only convenience setup uses it; deterministic
  assertions and all offset calculations use fixed explicit bases.

## Fix round 1: CI gates timestamp helper

Reviewer Important finding: recovery CI did not invoke the new
`tests/operations/utc-timestamp.bats`, leaving parser and overflow regressions outside the
recovery job. The recovery command now includes that helper suite before preservation, replacement,
restore, receipt, and repository gates. No test expectation changed.
Because workflow `run: >-` folds lines into one shell command, helper and existing paths share a
single `bats` invocation.

Changed file: `.github/workflows/v1-ci.yml`.

Verification under pinned Node `24.14.0`:

```text
PATH=/Users/andresholivin/.local/share/mise/installs/node/24.14.0/bin:$PATH bats tests/operations/utc-timestamp.bats
1..5
ok 1 UTC timestamp adds signed integer seconds to explicit RFC3339 base
ok 2 UTC timestamp accepts only exact UTC seconds and round-trips dates
ok 3 UTC timestamp rejects invalid mode and offset arguments
ok 4 UTC timestamp rejects overflow after checked second addition
ok 5 UTC timestamp supports now mode with strict UTC seconds output
```

```text
PATH=/Users/andresholivin/.local/share/mise/installs/node/24.14.0/bin:$PATH bats tests/operations/utc-timestamp.bats tests/operations/preservation-gate.bats tests/operations/production-replacement-gate.bats tests/operations/restore-drill.bats tests/operations/deletion-receipt-replay.bats tests/repository/legacy-removal-manifest.bats tests/repository/canonical-layout.bats
1..44
44 tests passed
```

YAML and diff checks:

```text
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/v1-ci.yml")'
git diff --check
```

Both passed. `.serena/` remained untouched.
