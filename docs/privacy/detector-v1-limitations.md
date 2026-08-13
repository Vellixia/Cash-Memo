# Privacy Detector v1: Scope and Limitations

Version: `privacy-detector-v1` Corpus: `corpus-v1`, synthetic fixtures only

## Supported finite rules

Seven families are tested: `PAN_LUHN_V1`, `IBAN_MOD97_V1`, `CARD_SECRET_LABEL_V1`,
`ACCESS_SECRET_LABEL_V1`, `BANK_ACCOUNT_LABEL_V1`, `ID_IDENTITY_LABEL_V1`, and
`STATEMENT_SOLICITATION_V1`. Current tested language cues include English, Indonesian, Spanish,
French, and German fragments explicitly present in rules/corpus.

Normalization occurs only in ephemeral memory. v1 applies Unicode NFKC, removes selected zero-width
characters, and normalizes selected whitespace. It stores no normalized candidate, matched span,
candidate hash, embedding, or explanation.

## Synthetic corpus measurement

Current `corpus-v1` test results are precision `1.0`, recall `1.0`, false positives `0`, and false
negatives `0` **on that versioned synthetic corpus only**. Method: expected-match fixtures count
true/false positives and expected-benign fixtures count true/false negatives against fixed rule
families.

These results do not mean detector is 100% accurate. They do not prove all prohibited data is
detected. They do not guarantee sensitive data cannot enter arbitrary text or speech.
Semantic-completeness claims are forbidden.

## Known limitations

- False positives: benign long identifiers, number-like prose, or labeled values may resemble
  supported patterns.
- False negatives: euphemisms, unsupported languages, novel separators, encoded/obfuscated values,
  images/files, fragmented values, and contextual meaning outside fixed patterns.
- Context: detector recognizes finite text shapes, not intent, ownership, legitimacy, or full
  document semantics.
- Adversarial input: homoglyphs outside normalization, unusual encoding, token splitting, and future
  formats may evade rules.
- Voice: detector cannot inspect speech before current raw audio reaches approved STT. Transcript
  checks happen after STT.

## User and incident paths

Blocked input remains editable in live form memory; user removes candidate or abandons capture.
Benign false positives use same correction/abandon path. Suspected miss or improper persistence
follows `ops/runbooks/privacy-incident.md`; evidence remains content-free. Rule/corpus changes
require versioning and regression measurement.
