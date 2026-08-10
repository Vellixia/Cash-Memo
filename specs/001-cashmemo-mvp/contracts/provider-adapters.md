# Provider Adapter Contracts

These are project-owned ports. Product/domain code cannot import provider SDK types or expose provider payloads through `openapi.yaml`. Values shown are contract notation, not implementation.

## Common Rules

1. Every call receives a validated current-capture input, an approved provider decision version, a deadline, and an opaque correlation ID.
2. Adapters send no account ID, email, memo history, search terms, existing records, unrelated draft, detector material, or telemetry context.
3. SDK request/response logging is disabled. Provider request IDs are HMACed before optional operational storage.
4. Retry is bounded to transient transport/rate-limit failures and never crosses the caller deadline. Validation/refusal failures are not retried blindly.
5. A fallback provider is never selected silently. Capability degradation is visible and a provider change requires a new approved decision record.
6. Provider output is schema-validated at the adapter and again by the application/domain boundary. An adapter success is never financial confirmation.

## STT Port v1

### Input

```text
TranscriptionRequestV1 {
  audio: ephemeral readable stream owned by TemporaryAudioLifecycle
  mediaType: webm_opus | ogg_opus | mp4_aac | wav_pcm | mp3
  byteLength: integer 1..10_485_760
  measuredDurationMs: integer 1..60_000
  languageHint: BCP-47 string | null
  deadlineAt: instant
  consentVersion: string
  providerDecisionVersion: string
  correlationId: opaque UUID
}
```

No method returns or transfers ownership of `audio`. The lifecycle owner deletes it on success, cancellation, terminal failure, or one-hour expiry. The adapter must tolerate stream cancellation and return a content-free result code.

### Output

```text
TranscriptionResultV1 =
  | {
      kind: "transcript";
      text: string 1..4000;
      language: BCP-47 string | null;
      completeness: "complete" | "incomplete";
      truncation: "none" | "provider_limit" | "deadline";
    }
  | {
      kind: "failure";
      code: "unavailable" | "timeout" | "rate_limited" |
            "unsupported_audio" | "invalid_output" | "refused";
      retryable: boolean;
      retryAfterSeconds: integer | null;
    };
```

The transcript is not persisted or sent to AI until the server privacy detector passes. A failure output contains no provider message or user content.

### Initial adapter

- Provider: OpenAI.
- Endpoint/model: `/v1/audio/transcriptions`, `gpt-4o-mini-transcribe-2025-12-15`.
- Allowed input formats are the intersection of provider support and the application allowlist.
- Production condition: approved decision evidence proves no training and no provider-side retention for the project/endpoint. ZDR is required for the shared production project.
- Provider-native segments, token probabilities, prompts, or metadata are discarded unless a future contract explicitly requires them.

## Extraction Port v1

### Input

```text
ExtractionRequestV1 {
  captureText: string 1..4000;          # current checked text/transcript only
  captureStartedAt: RFC3339 instant;    # relative-date anchor
  captureTimezone: canonical IANA zone;
  defaultCurrency: supported code;
  locale: supported BCP-47 tag;
  allowedCategories: [{ id: UUID, kind: income|expense, name: string }];
  allowedMoneySpaces: [{ id: UUID, name: string }];
  schemaVersion: "money-memo-draft-1";
  consentVersion: string;
  deadlineAt: instant;
  providerDecisionVersion: string;
  correlationId: opaque UUID;
}
```

Labels are required to map a phrase to an owned ID, but no unrelated memo/history is sent. The application must run detector controls on `captureText` and label names before this call.

### Strict provider output schema

```text
ExtractionCandidateV1 {
  schemaVersion: "money-memo-draft-1";
  fields: {
    direction: "income" | "expense" | null;
    amount: canonical unsigned decimal string | null;
    currency: uppercase 3-letter code | null;
    occurredLocal: ISO local date-time | null;
    occurredTimezone: IANA zone | null;
    occurredOffsetMinutes: integer -840..840 | null;
    categoryId: UUID | null;
    moneySpaceId: UUID | null;
    purpose: "personal" | "work" | "mixed" | null;
    planningStatus: "planned" | "unplanned" | null;
    note: string <= 4000 | null;
  };
  assessments: [{
    field: exact field enum;
    status: "provided" | "inferred" | "uncertain" | "missing" | "contradictory";
    reasonCode: "AMBIGUOUS_AMOUNT" | "AMBIGUOUS_DATE" |
      "AMBIGUOUS_DIRECTION" | "UNSUPPORTED_CURRENCY" |
      "UNKNOWN_LABEL" | "CONTRADICTORY_TEXT" | "PROVIDER_OMISSION" | null;
  }];
}
```

Strict schema validity is necessary, not sufficient. Application validation additionally:

- rejects unsupported/over-precision/zero/negative/overflow amount;
- validates category ownership and kind against direction;
- validates Money Space ownership;
- resolves relative dates from the immutable capture anchor;
- rejects/returns alternatives for ambiguous or nonexistent local time;
- rejects occurrence more than five minutes in the future;
- marks any conflicting/missing required field as correction required;
- never copies provider text into an authoritative memo without user review and confirmation.

### Result

```text
ExtractionResultV1 =
  | { kind: "candidate"; candidate: ExtractionCandidateV1 }
  | { kind: "correction_required"; safeReasonCodes: enum[] }
  | {
      kind: "failure";
      code: "unavailable" | "timeout" | "rate_limited" |
            "invalid_schema" | "refused";
      retryable: boolean;
      retryAfterSeconds: integer | null;
    };
```

### Initial adapter

- Provider: OpenAI.
- Endpoint/model: `/v1/responses`, `gpt-5.4-mini-2026-03-17`.
- Required flags: `store:false`, strict JSON Schema output, no tools, no files, no background processing.
- The product schema itself may be provider system metadata; the provider request still excludes user identity/history.
- Production condition: approved Zero Data Retention and training-disabled evidence. Default 30-day abuse monitoring is a launch blocker.

## Email Port v1

### Input

```text
TransactionalEmailV1 {
  kind: "verify_email" | "reset_password";
  destination: verified-format email;
  oneTimeUrl: same-origin HTTPS URL;
  expiresAt: instant;
  locale: supported locale;
  providerDecisionVersion: string;
}
```

Templates contain no journal, amount, label, transcript, export, deletion detail, IP, or diagnostic value. AWS SES message content is not copied to telemetry. Bounce/complaint processing maps destination to an internal HMAC before operational use.

### Output

```text
EmailResultV1 =
  | { kind: "accepted"; providerReferenceHmac: bytes }
  | { kind: "failure"; code: "unavailable" | "rate_limited" | "rejected"; retryable: boolean };
```

## Object Storage Port v1

Only export packages, content-safe acceptance evidence, and content-free deletion suppression/evidence are valid object classes. `raw_audio`, `transcript`, `prompt`, and `draft` are unrepresentable enum values.

```text
ObjectClass = "export_package" | "acceptance_evidence" |
              "deletion_suppression" | "deletion_evidence";
```

Every operation requires object class, account HMAC/scope, KMS key policy, maximum expiry, and expected checksum. Export reads are server-side streams after session/recent-auth checks; raw S3 URLs are not part of the product API.

### Deletion suppression record

`deletion_suppression` is the sole object class without a time-based maximum expiry. Its identity and body are content-free:

```text
DeletionSuppressionRecordV1 {
  deletionToken: HMAC-SHA-256 bytes;
  entityType: "money_memo" | "account";
  suppressionKeyVersion: string;
  purgedAt: instant;
  removalNotBeforeAt: instant;        # purgedAt + 42 days; floor, not TTL
  verificationState: "not_due" | "pending" | "blocked" |
                     "verified_eligible" | "removing" | "remove_failed";
  blockingArtifactClasses: enum[];
  policyVersion: string;
}
```

Token derivation is exactly:

```text
HMAC-SHA-256(suppression_key,
  UTF8(entity_type) || UTF8(":") || canonical_uuid_text(immutable_entity_id))
```

The adapter accepts no raw ID in a stored body/key, email, amount, note, label, account metadata, or journal value. Caller derives token in protected memory, writes it idempotently before irreversible live deletion, and clears raw ID material. S3 lifecycle cannot delete suppression records. Only the privileged backup-verification use case may issue removal after `removalNotBeforeAt` and successful full-lineage inventory; unavailable/failed verification cannot call delete.

Feature 001 denies manual/final/copied/shared snapshots, retained automated backups, AWS Backup recovery points, and replicated backups through infrastructure policy. Verifier still inventories these classes plus active isolated restore copies. A detected or unverifiable artifact returns `blocked`, retains the record, alerts, and retries.

## Provider Error Mapping

| Provider condition | Adapter result | Product behavior |
|---|---|---|
| Timeout/network | retryable timeout/unavailable | preserve draft; name unavailable capability; manual entry remains |
| Rate limit | retryable rate_limited | safe retry time; no provider detail |
| 4xx invalid input | terminal invalid output/input | correction or manual path; do not retry same content blindly |
| Provider 5xx | retryable unavailable | bounded retry; then degraded state |
| Invalid/malformed schema | invalid_schema | reject at trust boundary; retain source text; manual correction |
| Ambiguous fields | candidate with assessments | visually distinguish; user edits/chooses |
| Refusal/safety response | refused | safe explanation; no auto-confirm/fallback |
| Partial STT due interruption | incomplete transcript | label incomplete; never confirm automatically |

## Real-Provider Contract Evidence

For each approved adapter, protected CI/staging runs must record content-safe evidence of:

- exact provider/model/endpoint and decision version;
- settings proving training/retention policy;
- accepted media/schema fixtures and rejected invalid fixtures;
- timeout/rate-limit/error mapping;
- payload-capture proxy proof that only allowlisted current-capture fields leave the app;
- no SDK request/response logging;
- raw-audio deletion probe after every STT terminal path;
- adapter replacement/failure toggle proving manual journal independence.
