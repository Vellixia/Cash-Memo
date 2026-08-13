# Runtime secret delivery

Reuse the existing shared Infisical service through Dokploy/runtime environment injection. Cashmemo
does not deploy Infisical and does not import an Infisical SDK. API, worker, migration, restore,
deployment, and break-glass capability sets remain separate. Each process receives only its declared
canonical environment names. Missing required names fail startup; values never enter logs, errors,
diagnostics, image layers, browser bundles, or evidence.
