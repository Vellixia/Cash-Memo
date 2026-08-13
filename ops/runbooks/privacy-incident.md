# Privacy Incident Procedure

Use for suspected prohibited content persistence/transmission, diagnostic leakage, provider-boundary
failure, export exposure, or deletion failure. Examples use synthetic IDs only.

## 1. Detect

Accept privacy canary alarm, user report, provider notice, or security finding. Open restricted
incident using content-free incident ID and boundary class. Never paste candidate content.

## 2. Contain

Disable affected capture/provider path when propagation risk exists. Preserve content-safe hashes,
build/config versions, and fixed event classes. Restrict access. Do not copy request bodies, tokens,
journal data, or detector material into tickets/logs.

## 3. Classify

Identify failed boundary and whether impact includes browser/server persistence,
STT/AI/email/storage transmission, diagnostics, support, export, live deletion, or backups.
Determine account scope without exposing another account.

## 4. Correct or delete

Offer user correction where safe. Remove affected live content through supported lifecycle. Review
provider deletion state. If historical backups may contain deleted content, create/retain
suppression record and apply restore-reconciliation rules; elapsed time alone never proves cleanup.

## 5. Provider review

Determine whether content reached STT, AI, email, object storage, or another approved provider.
Follow provider decision/deletion obligations and retention limits. Missing provider proof remains
open and release-blocking where required.

## 6. Evidence

Write only fixed scenario IDs, counts, coarse states, timestamps, hashes, and approved environment
metadata. Scan evidence with privacy canaries. Never include prohibited content, raw identifiers,
email, tokens, payloads, or detector spans.

## 7. Governance

Privacy and Security own classification; service owner contains/corrects; Release owner controls
promotion. Rule changes require versioned detector/corpus updates, limitations review, and
regression test. High/critical unresolved impact blocks release.

## 8. User communication

Send only approved, account-scoped notice when legally or operationally required. Never reveal
another user's existence or data. State known facts and remaining uncertainty; do not claim
semantic-complete detection or provider deletion without proof.
