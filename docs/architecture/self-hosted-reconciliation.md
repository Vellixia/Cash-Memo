# Self-hosted service reconciliation

Status: repository architecture decision, 2026-08-13. This document does not prove a deployment. The
preceding AWS infrastructure work is superseded; historical evidence is retained as historical
evidence and is not relabeled.

## Selected architecture

Cashmemo uses one immutable OCI image with `api` and `worker` process roles, deployed with Dokploy.
PostgreSQL 18 is the financial and identity database. RustFS Primary is private S3-compatible
storage for exports and approved content-safe objects. pgBackRest writes its encrypted backup/WAL
repository to a separate RustFS Secondary. The content-free deletion suppression ledger also uses
Secondary, without TTL authority. Runtime secrets are injected from the existing shared Infisical
service. OTLP is exported to the existing shared collector and OpenObserve. Mailpit is the
development email sink; Cloudflare Email Service is the production transactional-email provider.
OpenAI remains the approved STT/extraction provider, subject to its separate production approval.

Cloudflare Tunnel, Traefik configuration, and public networking are outside this decision. No
duplicate PostgreSQL, Infisical, OTel collector, or OpenObserve service is created.

## Verified development facts

| Resource                     | Verified state                                                | Repository consequence                                                          |
| ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `cashmemo-test-postgres`     | PostgreSQL `18.4-alpine`, running, private, persistent volume | preserve service and volume; add only safe health/restart guidance              |
| Cashmemo API/Worker          | missing                                                       | define two roles from one immutable image digest                                |
| RustFS Primary               | hardened private skeleton, not deployed                       | pin reviewed version; real-service result remains open                          |
| RustFS Secondary Development | separate same-host skeleton, not deployed                     | development integration only; never claim independent failure domain            |
| pgBackRest                   | absent                                                        | provide versioned config and real restore test harness for next deployment pass |
| Infisical                    | shared service exists; Cashmemo integration absent            | use runtime secret injection; no app SDK coupling                               |
| OTel/OpenObserve             | shared services exist; Cashmemo integration absent            | bind canonical OTLP endpoint; no duplicate stack                                |

## Version decisions

| Component                | Decision                                                     | Source/review                                          | Production status                                                         |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| RustFS                   | `rustfs/rustfs:1.0.0-rc.1`; floating tags forbidden          | official RustFS GitHub release, reviewed 2026-08-13    | pre-release; development integration allowed, production approval blocked |
| pgBackRest               | `2.59.0`                                                     | official pgBackRest release notes, reviewed 2026-08-13 | stable; PITR still unproven until real restored state is inspected        |
| Cloudflare Email Service | REST API adapter against official account-scoped sending API | official Cloudflare docs, reviewed 2026-08-13          | service is beta; production configuration/approval blocked                |

An immutable release digest remains mandatory for the Cashmemo image. RustFS production promotion
additionally requires an approved immutable image digest or a documented immutable release-tag
policy.

## Impact matrix

| Path                                | Old assumption                                         | New responsibility                                       | Requirement/task               | Code/test/evidence impact                            | Reopen?                           |
| ----------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- | ------------------------------ | ---------------------------------------------------- | --------------------------------- |
| `spec.md`                           | provider-neutral                                       | preserve product properties                              | FR-001..FR-120, SC-001..SC-026 | no behavioral weakening                              | no                                |
| `plan.md`, `research.md`            | AWS regional stack                                     | Dokploy/self-hosted decision and external-service limits | T219..T241                     | replace platform rationale and closure claims        | yes                               |
| `data-model.md`, provider contracts | RDS/S3/KMS lineage vocabulary                          | PostgreSQL + RustFS + pgBackRest lineage                 | FR-094, FR-100                 | provider-neutral storage and actual artifact classes | yes                               |
| runtime environment schema          | AWS buckets/KMS/SES names                              | canonical DB, RustFS, backup, email, OTLP settings       | T004                           | fail-closed production validation                    | yes                               |
| `adapters/aws`                      | AWS object/ledger/inventory                            | S3-compatible RustFS and self-hosted lineage             | T167, T186, T190               | new adapters and contract/integration harnesses      | yes                               |
| email adapter/bootstrap             | SES-shaped production assumption and hardcoded Mailpit | EmailPort-selected Mailpit/Cloudflare adapters           | T052                           | safe failure mapping and tests                       | yes                               |
| `infra/opentofu`                    | creates whole AWS platform                             | superseded, not active deployment input                  | T219..T228                     | Dokploy compose/config; preserve existing PostgreSQL | yes                               |
| OCI/workflow/rollback               | ECS deployment                                         | artifact-only CI plus Dokploy deployment contract        | T229..T231                     | same digest for API/worker; next pass applies        | yes                               |
| operations/evidence                 | RDS PITR and AWS inventory                             | pgBackRest PITR, RustFS lineage, same-host caveat        | T185..T200, T240..T241         | new oracles; historical evidence stays historical    | yes where provider/oracle changed |
| real-service closure                | RDS/SES/S3/ECS/CloudWatch                              | deployed PostgreSQL/Cloudflare/RustFS/Dokploy/OTLP       | T261, T262, T265..T268         | fresh evidence only; remain unchecked                | descriptions replaced             |

## Non-negotiable closure limits

The same-host development Secondary is not disaster recovery. A started pgBackRest process is not
PITR proof. Mailpit is not Cloudflare production-email proof. Contract adapters are not RustFS
real-service proof. SC-021 remains open until a production-equivalent isolated restore uses an
independent failure-domain repository and validates restored database state after account-first and
memo suppression reconciliation.
