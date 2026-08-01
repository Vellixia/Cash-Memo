# Phase 3 Authentication, Isolation, and Privacy Evidence

- Date: 2026-08-01
- Owner: Backend/Web feature owner
- Scope: T038–T056
- Environment: isolated self-hosted Appwrite 1.9.6 project and checked-in TablesDB schema
- Secret handling: project key and session secrets remained in ignored runtime/scratch state and
  were not written to this evidence or command output

## Commands and results

| Command | Result |
|---|---|
| `npm run format` | PASS |
| `npm run lint` | PASS; zero warnings |
| `npm run typecheck` | PASS; strict TypeScript |
| `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` | PASS |
| `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets --all-features -- -D warnings` | PASS |
| `cargo test --manifest-path backend/Cargo.toml --workspace --all-targets` | PASS; 19 tests |
| `cargo clippy --manifest-path tests/integration-appwrite/Cargo.toml --all-targets -- -D warnings` | PASS |
| real `cargo test --manifest-path tests/integration-appwrite/Cargo.toml -- --test-threads=1 --nocapture` | PASS; 6 tests |
| `npm exec -- tsx tests/privacy/scan_captures.ts --self-test` | PASS; synthetic leak injections across 10 channels were detected |
| scanner over Appwrite, worker, proxy, and prior evidence captures | PASS; 5 captures, zero findings |

## Real Appwrite authentication and isolation assertions

- Two independent live Appwrite accounts and server-created opaque sessions were used.
- Each session validated through the supported Account API and produced only its account
  principal. Missing, invalid, and revoked sessions failed closed.
- Owner A could read and rename its label. Owner B received the same absent result used for an
  unknown resource and could not observe it in lists or mutate it.
- Existing-other-owner and unknown-ID lookups stayed inside the test's coarse network timing
  envelope; no strict constant-time claim is made.
- Starter Category and Money Space seeding ran twice for the same owner and returned the same two
  IDs without duplicates.
- Anonymous and authenticated user-session calls to a backend-private TablesDB row both received
  denial indistinguishable from an unknown caller-supplied row ID. Only the runtime server
  credential could observe the row.
- Appwrite was exercised only through supported Account, Users, TablesDB REST, and TablesDB
  GraphQL APIs. Cashmemo has no internal MongoDB access.

## Boundary and privacy assertions

- Every user repository query shape starts with exactly one owner predicate built from
  `AuthenticatedOwner`; caller attempts to add or replace `owner_id` are rejected.
- Scheduler and restore-reconcile capabilities are separate types and cannot substitute for a
  user principal.
- HTTP requests reject owner input, use bounded JSON, return stable problem codes, and apply
  `Cache-Control: no-store` without request-body logging.
- TanStack Query cache is memory-only and cleared on account switch. The typed web client uses
  credentialed relative requests and rejects value-bearing URL query strings.
- The privacy corpus covers amounts, notes, labels, searches, fingerprints, keys, cursors,
  tokens, auth, exports, and Pattern Set candidates. Its scanner detects raw, JSON-escaped,
  URL-encoded, base64, and SHA-256 forms.
- Published detector identifiers are allowed only in the specified HTTP privacy field error and
  are rejected from diagnostics and evidence. Candidate text and derivatives are never allowed.

Appwrite development-mode errors can contain framework traces and repeat a caller-supplied path
ID. The real denial test proved the same projection for existing and unknown IDs. Production
deployment must run Appwrite without development traces; Phase 13 operational hardening owns that
later feature-wide control, while T079 scans the US1 stack again.
