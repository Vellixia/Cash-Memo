# Currency Registry v1 Review

Registry version: `cldr47-iso4217-2026-01-01-cashmemo-v1`
Reviewed: 2026-08-09
Scope: 21 enabled currencies selected for an Indonesia-first MVP, ASEAN travel/remittance, and
common global use.

## Source pins

- Unicode CLDR 47 `supplementalData.xml`, SHA-256
  `3fb813039e4ab5041afc78c27fe35704b48e114513f008722e3e366473ed10b4`.
- Unicode CLDR 47 English currency display data, SHA-256
  `cdb3d09f4d5cd206616a57cc8a8cb54c458c6678758c59b8b817125fe2dfb147`.
- Unicode CLDR 47 Indonesian currency display data, SHA-256
  `b6a46305320587dee685c3422ac4c081ad183463b2156795edd2b6690bb3d23a`.
- ISO 4217 List One published 2026-01-01 by the ISO maintenance agency, SHA-256
  `838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9`.

The exact HTTPS URLs are stored with these hashes in `data/registry-v1.json`. A source update
requires a new reviewed registry version; it never reinterprets a saved memo snapshot.

## Review result

All enabled codes are canonical uppercase active codes in ISO List One. CLDR standard fraction
digits and ISO minor units agree:

| Exponent | Codes                                                                               |
| -------- | ----------------------------------------------------------------------------------- |
| 0        | JPY, KRW, VND                                                                       |
| 2        | AED, AUD, CAD, CHF, CNY, EUR, GBP, HKD, IDR, INR, MYR, NZD, PHP, SAR, SGD, THB, USD |
| 3        | KWD                                                                                 |

CLDR 47 declares standard digits `2` and cash digits `0` for IDR. Cashmemo has no cash-only mode, so
registry v1 uses the standard/ISO exponent `2`. Display may omit insignificant decimals according to
locale; authoritative minor units still retain exponent `2`.

Symbols and English display names are presentation hints, not identifiers. `Rp` is the reviewed
Indonesian IDR symbol. Currency code remains authoritative when a symbol is ambiguous.

## Structural exclusions

The registry contains only code, exponent, enabled state, display metadata, review version, and
content hashes. Runtime validation rejects unknown entry fields and any key containing `rate`,
`exchange`, or `conversion`. It has no exchange rates, base currency, converted values,
cross-currency total, or valuation behavior.
