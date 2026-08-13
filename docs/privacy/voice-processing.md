# Voice Privacy Boundary

Authoritative ordering:

```text
microphone
then current raw audio
then explicit consent
then approved STT provider
then transcript
then server textual detector
then extraction provider only when allowed and consented
```

Text detector cannot inspect speech before STT receives raw voice. Cashmemo does not claim
otherwise. Raw-audio provider boundary and transcript provider boundary are distinct.

Only current recording is sent to STT. No journal history, labels, prior memos, credentials, or
analytics context accompanies it. MIME, magic bytes, codec, measured duration, and size are checked.
Raw audio stays in bounded memory or approved encrypted task-local temporary storage and is removed
on success, cancellation, expiry, or terminal failure. It never belongs in PostgreSQL, RustFS,
IndexedDB, evidence, logs, traces, or metrics.

After STT, transcript crosses server detector before persistence and again before AI extraction.
Blocked transcript never reaches extraction. Allowed transcript reaches extraction only after
explicit transcript consent. Detection remains finite and best effort; see
`detector-v1-limitations.md`.
