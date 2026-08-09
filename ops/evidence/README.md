# Content-safe evidence

All Feature 001 evidence must be written through `@cashmemo/test-support`'s `EvidenceWriter`. It
accepts only the versioned check/result schema and the manifest fields declared in
`test-strategy.md`. Accepted artifacts are canonical JSON with mode `0600`; manifests reference
artifact bytes by SHA-256 and never copy check bodies, provider payloads, journal content, or raw
URLs.

Before any accepted write, the writer validates exact keys and scans the complete candidate for
configured synthetic canaries, emails, credentials, query-bearing URLs, money-like values, and
forbidden content/detector fields. Rejection creates only a content-free quarantine marker (hash,
byte length, reason code, time); rejected bytes are not persisted. Quarantine markers are gate
failures, never support attachments, and must be removed after investigation under the privacy
incident procedure.

Real financial or user/provider payload content is forbidden. Protected external artifacts are
referenced only by stable safe ID plus SHA-256 and remain access-controlled with their declared
retention policy.
