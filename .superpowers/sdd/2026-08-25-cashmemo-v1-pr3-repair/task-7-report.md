# Task 7 report: trusted-proxy-aware auth throttling

## Root cause

`AuthRateLimiter` used only `ConnectInfo<SocketAddr>` as its IP key. In production topology that
peer is Traefik, so unrelated clients shared one limiter bucket. No startup-validated trust
boundary existed for forwarded addresses.

## RED/GREEN

- Initial HTTP RED failed to compile because `TrustedProxyConfig` and a proxy-aware limiter
  constructor were absent.
- Baseline-equivalent direct-peer-only RED made the second distinct client behind one proxy return
  `429` instead of handler `401`, reproducing the shared bucket.
- Removing the 8192-byte header check made an oversized hostile prefix reach the handler (`401`)
  instead of failing before auth (`400`), proving that boundary test is effective.
- Compose RED reported three failures: no required API CIDRs, no rendered CIDRs, and no explicit
  Traefik safe-append/header-limit policy.
- GREEN: `http_safety` passed 12 tests; `operations` passed 7 tests; Compose contract passed.

## HTTP topology evidence

HTTP-level Axum middleware tests use `ConnectInfo<SocketAddr>`, not parser-only assertions. They
prove:

- untrusted direct peer overrides all spoofed forwarding headers;
- trusted direct peer strips only a trusted right-hand suffix;
- two public clients behind one proxy receive distinct buckets;
- malformed hostile left prefix is never parsed after rightmost client is established;
- trusted address inside an untrusted chain grants no authority;
- missing/malformed/all-trusted/over-2048-byte/over-16-hop metadata returns `400` without auth
  handler execution or shared proxy-bucket assignment.

`main.rs` already uses `into_make_service_with_connect_info::<SocketAddr>()`; no artificial edit
was needed. The real-server operations tests retained this path.

## Configuration and Compose evidence

- `TrustedProxyConfig` defaults to empty CIDRs, 8192 edge/header bytes, 2048 Rust suffix bytes, and
  16 hops. Invalid comma-separated CIDRs fail startup parsing.
- Dokploy Compose requires explicit `CASHMEMO_V1_TRUSTED_PROXY_CIDRS` for its proxied production
  topology.
- Exact external-Traefik static arguments specify `insecure=false`, safe append
  (`notAppendXForwardedFor=false`), narrow optional upstream `trustedIPs`, and
  `http.maxHeaderBytes=8192`.
- Compose contract test asserts required/rendered API CIDRs and all four Traefik arguments.
- `infra/v1/traefik.md` states the `x-traefik-static-arguments` extension is operator metadata,
  not an external mutation. Managed-Traefik inspection and public two-client probes remain the
  route-activation gate.
- V1 remains one API replica with bounded in-memory limits. No Redis or attempt table added.

## Changed files

- `Cargo.toml`, `Cargo.lock`, `apps/api/Cargo.toml`
- `apps/api/src/app.rs`, `apps/api/src/config.rs`, `apps/api/src/error.rs`
- `apps/api/src/http/rate_limit.rs`, `apps/api/tests/http_safety.rs`
- `infra/v1/env.example`, `infra/v1/traefik.md`, `infra/v1/dokploy-compose.yml`
- `infra/v1/test-dokploy-compose.sh`
- `docs/verification/v1-pr3-repair-evidence.md`
- `.superpowers/sdd/2026-08-25-cashmemo-v1-pr3-repair/task-7-report.md`

## Self-review

- Resolver checks the authoritative direct peer before reading any forwarding header.
- Trusted scan is lazy right-to-left and creates no combined chain copy. Bounds apply before hop
  parsing; successful client resolution returns before hostile left-prefix parsing.
- Invalid forwarding resolves before auth-body parsing, limiter mutation, and handler execution.
- Empty trust is safe for direct/local use; proxied Compose deployment requires explicit CIDRs.
- Existing `.serena/` remains untracked and untouched. No production/Dokploy mutation, push, or
  merge occurred.
- Strict Clippy was blocked only by two pre-existing `new_without_default` warnings in account
  deletion test hooks. Rerun allowing that one unrelated lint passed with `-D warnings` otherwise.

## Commit

Signed commit subject: `fix: resolve auth clients through trusted proxies`.
