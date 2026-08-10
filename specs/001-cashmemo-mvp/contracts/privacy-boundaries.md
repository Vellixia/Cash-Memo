# Privacy Boundary Contract

## Rule Set v1

Finite detectors are best-effort controls, not complete semantic recognition. Every rule has a stable ID, version, covered input types, normalization performed in ephemeral memory, fixtures, false-positive/false-negative measurements, and user-safe warning code.

Initial supported families:

| Rule family | Candidate pattern/control | Required result |
|---|---|---|
| `PAN_LUHN_V1` | 13–19 digits with common separators and valid Luhn checksum | block covered boundary |
| `IBAN_MOD97_V1` | country/check digits plus BBAN shape and mod-97 validation | block covered boundary |
| `CARD_SECRET_LABEL_V1` | CVV/CVC/PIN/OTP label adjacent to 3–8 digit/alphanumeric candidate | block covered boundary |
| `ACCESS_SECRET_LABEL_V1` | password/passcode/access-token/API-token label adjacent to candidate | block covered boundary |
| `BANK_ACCOUNT_LABEL_V1` | supported-language bank/account-number label adjacent to 6–34 digit/alphanumeric candidate | block covered boundary |
| `ID_IDENTITY_LABEL_V1` | Indonesian NIK/KTP/passport/government-ID label adjacent to structurally plausible candidate | block covered boundary |
| `STATEMENT_SOLICITATION_V1` | product-owned copy/schema requesting a full statement | release gate failure; user text phrase alone is guidance, not proof of a statement |

Detector output is only `{ matched: boolean, ruleFamily: stable enum }` in live control flow. The candidate, spans, normalized text, hashes, embeddings, or match explanation are never persisted or emitted. Even `ruleFamily` is excluded from user-specific telemetry; aggregate detector health uses synthetic test traffic only.

## Boundary Matrix

| Boundary | Client check | Mandatory server check | On match |
|---|---|---|---|
| Arbitrary text → IndexedDB draft | yes | not crossed | keep only live form memory; warn/block local persistence |
| Arbitrary text/note/label → server persistence | advisory duplicate | yes, before transaction write | no write; safe warning |
| Typed natural language → AI | advisory duplicate | yes, immediately before provider adapter | no request; safe warning |
| Raw voice → STT | no semantic detector possible before transcription | size/type/duration plus explicit consent; STT is the requested current operation | transmit only current audio; disclose unavoidable detection limitation |
| STT transcript → server draft | optional post-STT client | yes, before persistence | do not persist candidate transcript; allow live correction/abandonment |
| Transcript → AI | advisory duplicate | yes, immediately before provider adapter | no AI request |
| Search text → PostgreSQL query | advisory duplicate | yes before query; query remains transient | no query execution |
| User content → telemetry/evidence/support | never accepted | typed allowlist makes content unrepresentable; canary scan | drop/reject signal and raise privacy control alarm |

## User Guidance

Adjacent to every arbitrary text, transcript editor, and voice start control:

> Do not enter bank account or card numbers, passwords, access tokens, full bank statements, or government ID information. Cashmemo does not need them.

Copy may be localized without weakening the listed classes. Voice consent also states that current audio goes to the approved STT provider and the resulting transcript may go to the approved AI provider after controls.

## Product Error

HTTP `422 PRIVACY_BOUNDARY_BLOCKED` returns only:

```json
{
  "code": "PRIVACY_BOUNDARY_BLOCKED",
  "messageCode": "REMOVE_SENSITIVE_INFORMATION_OR_ABANDON_CAPTURE",
  "correlationId": "opaque-uuid",
  "retryable": false,
  "retryAfterSeconds": null,
  "fieldErrors": [],
  "currentRevision": null
}
```

It never echoes the input, classifies a specific identity/credential to the user, or returns the matched span. The UI highlights the entry point, not the candidate substring, and lets the user edit in live memory or abandon.

## Measurement and Claims

- Build a synthetic, legally safe multilingual corpus covering supported rules and adversarial separators/Unicode confusables.
- Publish per-rule precision/recall on that corpus, corpus version, supported languages, and known bypass/false-positive classes.
- Do not publish “all sensitive data is detected,” “nothing sensitive can be entered,” or equivalent.
- Release interfaces must state: supported patterns are blocked when detected; arbitrary-language detection is finite and may miss or misclassify content.

