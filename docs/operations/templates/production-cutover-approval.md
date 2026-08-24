# Production cutover approval — INVALID TEMPLATE

No authority until every placeholder is replaced, preservation evidence is HMAC-signed, and gate
passes.

- Target ID: `REPLACE_WITH_TARGET_ID`
- Dokploy service/config digest: `REPLACE_WITH_DOKPLOY_SERVICE` /
  `REPLACE_WITH_SHA256_CONFIG_DIGEST`
- DB name/fingerprint: `REPLACE_WITH_DATABASE_NAME` / `REPLACE_WITH_SHA256_FINGERPRINT`
- Image/config/routing evidence: `REPLACE_WITH_IMMUTABLE_DIGESTS`
- Operator approval: `REPLACE_WITH_APPROVAL`

Run `scripts/production-replacement-gate.sh` before migration, deployment, or route cutover.
