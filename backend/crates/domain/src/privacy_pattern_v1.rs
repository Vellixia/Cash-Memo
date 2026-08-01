//! Deterministic finite Pattern Set v1 detector with ephemeral preprocessing.

use regex::Regex;
use unicode_normalization::UnicodeNormalization;

use crate::{DomainError, ErrorCode, FieldViolation};

const REGISTRY: &str = include_str!("../../../../shared/privacy/pattern-set-v1.json");
const DECIMAL_DIGIT_STARTS: &[u32] = &[
    0x0030, 0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6,
    0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80,
    0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0,
    0xff10, 0x104a0, 0x10d30, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0,
    0x11650, 0x116c0, 0x11730, 0x118e0, 0x11950, 0x11c50, 0x11d50, 0x11da0, 0x16a60, 0x16ac0,
    0x16b50,
];

/// Published blocking detector identifiers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BlockingDetector {
    /// Luhn-valid 13–19 digit PAN-like candidate.
    B1PanLuhn,
    /// Mod-97-valid IBAN candidate.
    B2IbanMod97,
    /// Labeled account identifier.
    B3LabeledAccount,
    /// Labeled routing identifier.
    B4LabeledRouting,
    /// Labeled card secret.
    B5LabeledCardSecret,
    /// Labeled banking credential.
    B6LabeledBankCredential,
    /// Labeled banking token.
    B7LabeledBankToken,
    /// Multi-row statement paste.
    B8StatementPaste,
    /// Labeled government identifier.
    B9LabeledGovId,
}

impl BlockingDetector {
    /// Exact safe public ID. It is permitted only in HTTP 422 field errors.
    #[must_use]
    pub const fn safe_id(self) -> &'static str {
        match self {
            Self::B1PanLuhn => "B1_PAN_LUHN",
            Self::B2IbanMod97 => "B2_IBAN_MOD97",
            Self::B3LabeledAccount => "B3_LABELED_ACCOUNT",
            Self::B4LabeledRouting => "B4_LABELED_ROUTING",
            Self::B5LabeledCardSecret => "B5_LABELED_CARD_SECRET",
            Self::B6LabeledBankCredential => "B6_LABELED_BANK_CREDENTIAL",
            Self::B7LabeledBankToken => "B7_LABELED_BANK_TOKEN",
            Self::B8StatementPaste => "B8_STATEMENT_PASTE",
            Self::B9LabeledGovId => "B9_LABELED_GOV_ID",
        }
    }
}

/// Published warning-only detector identifiers; never transmitted as an attestation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WarningDetector {
    /// Ambiguous banking phrase.
    W1BankingContext,
    /// Unlabeled long digit candidate.
    W2UnlabeledLongNumber,
    /// Statement header without full statement structure.
    W3StatementHeader,
}

/// One finite detector decision. It intentionally contains no candidate, offsets, or derivatives.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PatternDecision {
    /// No declared v1 pattern matched.
    Clear,
    /// Submission must stop.
    Block(BlockingDetector),
    /// User correction/continue choice is required at client boundary.
    Warn(WarningDetector),
}

/// Confirms the checked-in registry is valid JSON and exactly versioned.
pub fn validate_registry() -> Result<(), DomainError> {
    let value: serde_json::Value = serde_json::from_str(REGISTRY).map_err(|_| unavailable())?;
    if value.get("version").and_then(serde_json::Value::as_str) != Some("pattern-set-v1") {
        return Err(unavailable());
    }
    Ok(())
}

/// Runs exact finite v1 construction synchronously; normalized text is dropped before return.
#[must_use]
pub fn detect(value: &str) -> PatternDecision {
    let normalized = preprocess(value);
    if pan_luhn(&normalized) {
        return PatternDecision::Block(BlockingDetector::B1PanLuhn);
    }
    if iban_mod97(&normalized) {
        return PatternDecision::Block(BlockingDetector::B2IbanMod97);
    }
    if labeled_account(&normalized) {
        return PatternDecision::Block(BlockingDetector::B3LabeledAccount);
    }
    if labeled_routing(&normalized) {
        return PatternDecision::Block(BlockingDetector::B4LabeledRouting);
    }
    if labeled_card_secret(&normalized) {
        return PatternDecision::Block(BlockingDetector::B5LabeledCardSecret);
    }
    if labeled_credential(&normalized) {
        return PatternDecision::Block(BlockingDetector::B6LabeledBankCredential);
    }
    if labeled_token(&normalized) {
        return PatternDecision::Block(BlockingDetector::B7LabeledBankToken);
    }
    if statement_paste(&normalized) {
        return PatternDecision::Block(BlockingDetector::B8StatementPaste);
    }
    if labeled_government_id(&normalized) {
        return PatternDecision::Block(BlockingDetector::B9LabeledGovId);
    }
    if statement_header(&normalized) {
        return PatternDecision::Warn(WarningDetector::W3StatementHeader);
    }
    if banking_context(&normalized) {
        return PatternDecision::Warn(WarningDetector::W1BankingContext);
    }
    if unlabeled_long_number(&normalized) {
        return PatternDecision::Warn(WarningDetector::W2UnlabeledLongNumber);
    }
    PatternDecision::Clear
}

/// Converts blocking decision into stable privacy error with no examined value.
#[must_use]
pub fn blocking_error(field: &'static str, detector: BlockingDetector) -> DomainError {
    DomainError {
        code: ErrorCode::PrivacyInputRejected,
        message: "free-text input must be corrected",
        retryable: false,
        violations: vec![FieldViolation {
            field,
            rule: "pattern_set_v1_block",
            message: "Remove prohibited data before submitting.",
            detector_id: Some(detector.safe_id()),
        }],
        existing_memo_id: None,
    }
}

fn preprocess(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .nfkc()
        .flat_map(|character| {
            decimal_digit(character)
                .map_or_else(|| character.to_string(), |digit| digit.to_string())
                .chars()
                .collect::<Vec<_>>()
        })
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

fn decimal_digit(character: char) -> Option<u8> {
    let point = u32::from(character);
    for start in DECIMAL_DIGIT_STARTS {
        if (*start..=*start + 9).contains(&point) {
            return u8::try_from(point - start).ok();
        }
    }
    (0x1d7ce..=0x1d7ff)
        .contains(&point)
        .then(|| u8::try_from((point - 0x1d7ce) % 10).ok())
        .flatten()
}

fn digit_candidates(value: &str) -> impl Iterator<Item = String> + '_ {
    value
        .split(|character: char| {
            !(character.is_ascii_digit() || matches!(character, ' ' | '\t' | '-'))
        })
        .filter_map(|candidate| {
            let compact: String = candidate.chars().filter(char::is_ascii_digit).collect();
            (!compact.is_empty()).then_some(compact)
        })
}

fn pan_luhn(value: &str) -> bool {
    digit_candidates(value).any(|digits| {
        (13..=19).contains(&digits.len())
            && digits
                .bytes()
                .rev()
                .enumerate()
                .map(|(index, byte)| {
                    let mut digit = u32::from(byte - b'0');
                    if index % 2 == 1 {
                        digit *= 2;
                        if digit > 9 {
                            digit -= 9;
                        }
                    }
                    digit
                })
                .sum::<u32>()
                % 10
                == 0
    })
}

fn iban_mod97(value: &str) -> bool {
    value
        .split(|character: char| {
            !(character.is_ascii_alphanumeric() || matches!(character, ' ' | '\t' | '-'))
        })
        .map(|candidate| {
            candidate
                .chars()
                .filter(char::is_ascii_alphanumeric)
                .collect::<String>()
        })
        .any(|candidate| {
            let bytes = candidate.as_bytes();
            if !(15..=34).contains(&bytes.len())
                || !bytes[0].is_ascii_alphabetic()
                || !bytes[1].is_ascii_alphabetic()
                || !bytes[2].is_ascii_digit()
                || !bytes[3].is_ascii_digit()
            {
                return false;
            }
            bytes[4..]
                .iter()
                .chain(bytes[..4].iter())
                .try_fold(0_u32, |remainder, byte| {
                    if byte.is_ascii_digit() {
                        Some((remainder * 10 + u32::from(*byte - b'0')) % 97)
                    } else if byte.is_ascii_alphabetic() {
                        let value = u32::from(byte.to_ascii_uppercase() - b'A') + 10;
                        Some(((remainder * 100) + value) % 97)
                    } else {
                        None
                    }
                })
                == Some(1)
        })
}

fn lines(value: &str) -> impl Iterator<Item = &str> {
    value.split('\n')
}

fn after_label<'a>(line: &'a str, labels: &[&str]) -> Option<&'a str> {
    labels.iter().find_map(|label| {
        line.find(label).and_then(|position| {
            let tail = &line[position + label.len()..];
            let candidate = tail.trim_start_matches(|character: char| {
                character.is_ascii_whitespace() || matches!(character, ':' | '=' | '#')
            });
            (tail.chars().count() - candidate.chars().count() <= 32).then_some(candidate)
        })
    })
}

fn compact_prefix(value: &str, maximum: usize) -> String {
    value
        .chars()
        .take_while(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ' ' | '\t' | '-')
        })
        .filter(char::is_ascii_alphanumeric)
        .take(maximum + 1)
        .collect()
}

fn labeled_account(value: &str) -> bool {
    const LABELS: &[&str] = &[
        "account number",
        "account no",
        "account #",
        "acct number",
        "acct no",
        "a/c no",
        "nomor rekening",
        "no rekening",
        "no. rekening",
    ];
    lines(value).any(|line| {
        after_label(line, LABELS).is_some_and(|tail| {
            let candidate = compact_prefix(tail, 34);
            (6..=34).contains(&candidate.len())
        })
    })
}

fn labeled_routing(value: &str) -> bool {
    lines(value).any(|line| {
        after_label(line, &["routing number", "routing no", "aba"]).is_some_and(|tail| {
            let digits = compact_prefix(tail, 9);
            digits.len() == 9
                && digits.bytes().all(|byte| byte.is_ascii_digit())
                && aba_checksum(&digits)
        }) || after_label(line, &["sort code", "bsb"]).is_some_and(|tail| {
            let digits = compact_prefix(tail, 6);
            digits.len() == 6 && digits.bytes().all(|byte| byte.is_ascii_digit())
        })
    })
}

fn aba_checksum(value: &str) -> bool {
    let digits: Vec<u32> = value.bytes().map(|byte| u32::from(byte - b'0')).collect();
    (3 * (digits[0] + digits[3] + digits[6])
        + 7 * (digits[1] + digits[4] + digits[7])
        + digits[2]
        + digits[5]
        + digits[8])
        .is_multiple_of(10)
}

fn labeled_card_secret(value: &str) -> bool {
    const LABELS: &[&str] = &[
        "cvv",
        "cvc",
        "cid",
        "card verification code",
        "card security code",
        "kode keamanan kartu",
    ];
    lines(value).any(|line| {
        after_label(line, LABELS).is_some_and(|tail| {
            let token: String = tail.chars().take_while(char::is_ascii_digit).collect();
            (3..=4).contains(&token.len())
        })
    })
}

fn labeled_credential(value: &str) -> bool {
    const LABELS: &[&str] = &[
        "bank password",
        "banking password",
        "online banking password",
        "internet banking password",
        "bank pin",
        "atm pin",
        "mobile banking pin",
        "m-banking pin",
        "password bank",
        "pin bank",
    ];
    lines(value).any(|line| {
        after_label(line, LABELS).is_some_and(|tail| {
            let length = tail
                .chars()
                .take_while(|character| !character.is_whitespace())
                .count();
            (4..=128).contains(&length)
        })
    })
}

fn labeled_token(value: &str) -> bool {
    const LABELS: &[&str] = &[
        "bank access token",
        "banking access token",
        "bank refresh token",
        "banking token",
        "mobile banking token",
        "internet banking token",
        "bank otp",
        "banking otp",
        "bank tac",
    ];
    lines(value).any(|line| {
        after_label(line, LABELS).is_some_and(|tail| {
            let length = tail
                .chars()
                .take_while(|character| {
                    character.is_ascii_alphanumeric()
                        || matches!(character, '.' | '_' | '~' | '+' | '/' | '-' | '=')
                })
                .count();
            (6..=512).contains(&length)
        })
    })
}

fn statement_headers() -> &'static [&'static str] {
    &[
        "bank statement",
        "account statement",
        "rekening koran",
        "mutasi rekening",
    ]
}

fn statement_header(value: &str) -> bool {
    statement_headers()
        .iter()
        .any(|header| value.contains(header))
}

fn statement_paste(value: &str) -> bool {
    if !statement_header(value) {
        return false;
    }
    let markers = [
        "account number",
        "nomor rekening",
        "statement period",
        "periode",
        "opening balance",
        "saldo awal",
        "closing balance",
        "saldo akhir",
        "transaction date",
        "tanggal transaksi",
        "debit",
        "credit",
    ];
    if markers
        .iter()
        .filter(|marker| value.contains(**marker))
        .count()
        < 2
    {
        return false;
    }
    let date = Regex::new(r"(?:\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4}|\d{2}-\d{2}-\d{4})").ok();
    date.is_some_and(|date| {
        lines(value)
            .filter(|line| {
                date.is_match(line) && line.chars().any(|character| character.is_ascii_digit())
            })
            .take(3)
            .count()
            >= 3
    })
}

fn labeled_government_id(value: &str) -> bool {
    let ssn = Regex::new(r"\d{3}-\d{2}-\d{4}").ok();
    lines(value).any(|line| {
        after_label(line, &["ssn", "social security number"])
            .is_some_and(|tail| ssn.as_ref().is_some_and(|pattern| pattern.is_match(tail)))
            || after_label(line, &["nik", "nomor induk kependudukan"]).is_some_and(|tail| {
                let digits = compact_prefix(tail, 16);
                digits.len() == 16 && digits.bytes().all(|byte| byte.is_ascii_digit())
            })
            || after_label(line, &["government id", "national id", "identity number"]).is_some_and(
                |tail| {
                    let candidate = compact_prefix(tail, 24);
                    (6..=24).contains(&candidate.len())
                },
            )
    })
}

fn banking_context(value: &str) -> bool {
    [
        "bank account",
        "card number",
        "bank statement",
        "bank token",
        "bank password",
        "rekening",
        "kartu kredit",
        "kartu debit",
    ]
    .iter()
    .any(|phrase| value.contains(phrase))
}

fn unlabeled_long_number(value: &str) -> bool {
    digit_candidates(value).any(|digits| (6..=34).contains(&digits.len()))
}

fn unavailable() -> DomainError {
    DomainError::retryable(
        ErrorCode::DependencyUnavailable,
        "privacy boundary unavailable",
    )
}
