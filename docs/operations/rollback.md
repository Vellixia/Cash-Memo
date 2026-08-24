# Rollback

Before production verification, retain prior immutable image digests, config, routing state, and
recoverable database state. After V1 accepts real writes, never silently route traffic to stale
legacy. Preserve both states, stop cutover, and require explicit reconciliation procedure and
operator decision. Run preservation gate before any production replacement or route cutover.
