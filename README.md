# Cashmemo

Privacy-first manual money journal. Feature 001 uses Next.js App Router and one Rust/Axum modular
monolith. Appwrite authentication and TablesDB are reached only through supported APIs. Domain code
does not depend on HTTP, Appwrite, browser storage, UI, or telemetry adapters.

Cashmemo Constitution takes precedence over implementation convenience. C-07 remains approved,
release-visible, and governed: finite Pattern Set v1 reduces risk at arbitrary free-text boundaries
without claiming complete semantic detection.

## Scope

Included: manual Money Memo lifecycle, exact money/time, owner isolation, recoverable compose draft,
durable creation idempotency, categories, Money Spaces, export, deletion, and privacy-safe telemetry.

Excluded: voice, STT, AI, bank connections, sensitive banking fields, recurring memos, currency
conversion, native apps, general offline synchronization, application Redis, and microservices.

## Commands

Install Node 24, Rust 1.97.1, Docker Compose, and `just`, then run:

```bash
just secrets-dev-init
just format-check
just lint
just typecheck
just test-unit
just test-integration-real
just test-privacy-real
just acceptance us1-create
```

Local secrets live only in ignored `config/local-secrets/`. Never print or commit them. PWA caches
static shell assets only; API requests remain network-only and `no-store`.
