# Supported Currency Registry v1

**Registry ID**: `iso4217-list-one-2026-01-01`  
**Authoritative source**: [SIX ISO 4217 List One XML](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml)  
**Published**: 2026-01-01  
**Source SHA-256**: `838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9`

Version 1 supported list is exact unique set of `<Ccy>` values in this pinned XML whose same
`<CcyNtry>` has numeric `<CcyMnrUnts>`. Minor-unit scale is that integer. Entries missing code or
with `N.A.` minor units are excluded. Duplicate country entries for same code collapse to one
code and must agree on currency name/minor-unit scale; build fails on disagreement.

Implementation vendors normalized JSON generated from pinned bytes and verifies checksum in CI.
Runtime never fetches mutable network list. `GET /v1/reference/currencies` returns vendored set,
code-sorted, with registry ID and source effective date.

Export serialization uses registry `minorUnitScale` as exact decimal width: scale 0 has no decimal
point; scales 1, 2, 3, and 4 have exactly that many fractional digits. Too few or too many digits
are invalid. Contract tooling MUST derive or verify the five conditional branches in
`export-v1.schema.json` from this scale contract and MUST fail if registry data contains a scale
outside 0–4 or a schema branch is missing/disagrees.

Updating currencies requires new registry ID, source/checksum review, changed-code impact report,
and explicit rule for existing memos. Existing memo always preserves stored currency and scale;
registry update never converts or rewrites amount.
