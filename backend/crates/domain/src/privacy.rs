//! Pattern Set result and safe public metadata. Candidate text is never represented here.

use std::fmt;

use serde::{Deserialize, Serialize};

/// Published Pattern Set v1 blocking IDs safe only in HTTP 422 field responses.
#[derive(Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
pub enum SafeDetectorId {
    /// Luhn-valid PAN-shaped value.
    #[serde(rename = "B1_PAN_LUHN")]
    B1PanLuhn,
    /// MOD-97-valid IBAN.
    #[serde(rename = "B2_IBAN_MOD97")]
    B2IbanMod97,
    /// Labeled account value.
    #[serde(rename = "B3_LABELED_ACCOUNT")]
    B3LabeledAccount,
    /// Labeled routing value.
    #[serde(rename = "B4_LABELED_ROUTING")]
    B4LabeledRouting,
    /// Labeled card secret.
    #[serde(rename = "B5_LABELED_CARD_SECRET")]
    B5LabeledCardSecret,
    /// Labeled banking credential.
    #[serde(rename = "B6_LABELED_BANK_CREDENTIAL")]
    B6LabeledBankCredential,
    /// Labeled banking token.
    #[serde(rename = "B7_LABELED_BANK_TOKEN")]
    B7LabeledBankToken,
    /// Statement paste.
    #[serde(rename = "B8_STATEMENT_PASTE")]
    B8StatementPaste,
    /// Labeled government identifier.
    #[serde(rename = "B9_LABELED_GOV_ID")]
    B9LabeledGovId,
}

impl fmt::Debug for SafeDetectorId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SafeDetectorId([REDACTED])")
    }
}

/// Safe outcome with no candidate, position, normalization, hash, or derivative.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum PatternOutcome {
    /// No declared v1 pattern.
    Clear,
    /// Ambiguous local warning class.
    Warning(WarningId),
    /// Server-blocking class.
    Blocking(SafeDetectorId),
}

impl fmt::Debug for PatternOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Clear => formatter.write_str("PatternOutcome::Clear"),
            Self::Warning(_) => formatter.write_str("PatternOutcome::Warning([REDACTED])"),
            Self::Blocking(_) => formatter.write_str("PatternOutcome::Blocking([REDACTED])"),
        }
    }
}

/// Warning identifiers kept only in synchronous local decision flow.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum WarningId {
    /// Banking phrase context.
    W1BankingContext,
    /// Unlabeled long number.
    W2UnlabeledLongNumber,
    /// Statement header without full paste threshold.
    W3StatementHeader,
}

impl fmt::Debug for WarningId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("WarningId([REDACTED])")
    }
}

/// Release-visible governance trace without candidate data.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct C07Trace {
    /// Fixed detector set version.
    pub detector_set: &'static str,
    /// Approved exception ID.
    pub exception: &'static str,
    /// Complete semantic detection is never claimed.
    pub complete_detection_claimed: bool,
}

impl C07Trace {
    /// Feature 001 trace marker.
    pub const V1: Self = Self {
        detector_set: "pattern-set-v1",
        exception: "C-07",
        complete_detection_claimed: false,
    };
}
