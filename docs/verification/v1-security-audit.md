# Cashmemo V1 local security and database audit

Status: **PASS for named Rust audit binaries.** Browser acceptance separately passes on follow-up
implementation `cf4e6f58efa7b386d64fca796f89b753b41718f8`; see acceptance evidence.

Recorded: `2026-08-25T02:18:49+0700 WIB`

Baseline source commit: `0dcc7aa9c45cb9921077f5dc6e090ad33950af69`

Follow-up implementation under browser-test: `cf4e6f58efa7b386d64fca796f89b753b41718f8`
(`test: stabilize V1 parallel acceptance`). Its default six-flow/four-worker browser gate passed
fresh at `2026-08-25T02:42:27+0700 WIB`.

This audit used isolated `cashmemo_e2e` PostgreSQL only. It did not inspect a Dokploy environment,
production database, deployed image, route, backup, or user data.

```sh
DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:54329/cashmemo_e2e \
  cargo test -p cashmemo-api --test ownership --test auth --test account_deletion --test recurring --test migrations

DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:54329/cashmemo_e2e \
  cargo test -p cashmemo-api --test money
```

Both commands exited `0`. `money` is explicitly included because it owns authoritative money
precision behavior and is not named by brief aggregate command.

| Requirement                                                                | Direct evidence                                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Cross-user ownership isolation and opaque foreign-resource behavior        | `ownership` passed; V1 tests user-scoped queries/composite ownership constraints.                            |
| Session issuance, revocation, reset/logout behavior, cookie bounds         | `auth` passed; `account_deletion` also passed concurrent login/deletion closure.                             |
| Exact money, currency precision, scale/range rejection, no float authority | `money` passed.                                                                                              |
| Recurrence cadence and idempotent occurrence generation                    | `recurring` passed.                                                                                          |
| Deletion/purge races, lease takeover, retryable receipt/DB failures        | `account_deletion` passed all six cases, including atomic claim and concurrent-login closure.                |
| Empty/identified V1 target allowance; unknown non-empty target rejection   | `migrations` passed. Playwright preflight independently exercised protection when SQLx metadata was present. |

This is source-and-disposable-test evidence, not claim that production sessions, balances,
recurrence, retention, or migration state have been audited.

Source artifact digests: OpenAPI `6d3511058d1907e65aa32802bbacdff4d356e71bd749dc588f3069b3115584b8`;
generated-client tree `ed53f6d2624deef4db0666209a0476123132e2ccbbeb2ea8b4b96d1549a8b9d2`; migration
tree `a9f332788eb326bc245d22f172191cec76f8faa49ee1be2746d838ea20b110b4`; V1 CI workflow
`e0b75a79fe7c6e77bf4c0063312cb05d4ced1f59c9e6961ab7d2debe1cd1a0b9`.
