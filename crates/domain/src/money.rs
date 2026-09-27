//! Minor-unit exponents and decimal conversion. Must match apps/web/lib/money.ts `exponent()`:
//! V8's "en" Intl data with the same pinned zero-decimal currencies.

/// Digits after the decimal point for `currency` (ISO 4217); 2 for anything not listed.
pub fn exponent(currency: &str) -> u32 {
    const ZERO: &str = "AFN ALL BIF CLP COP DJF GNF HUF IDR IQD IRR ISK JPY KMF KPW KRW LAK LBP MGA MMK PKR PYG RWF SLL SOS SYP UGX VND VUV XAF XOF XPF YER";
    const THREE: &str = "BHD JOD KWD LYD OMR TND";
    if ZERO.split(' ').any(|c| c == currency) {
        0
    } else if THREE.split(' ').any(|c| c == currency) {
        3
    } else {
        2
    }
}

/// 123456 USD -> "1234.56"; 7500000 IDR -> "7500000".
pub fn to_decimal(amount_minor: i64, currency: &str) -> String {
    let exp = exponent(currency);
    if exp == 0 {
        return amount_minor.to_string();
    }
    let scale = 10_i64.pow(exp);
    let sign = if amount_minor < 0 { "-" } else { "" };
    let abs = amount_minor.unsigned_abs();
    format!(
        "{sign}{}.{:0width$}",
        abs / scale as u64,
        abs % scale as u64,
        width = exp as usize
    )
}

/// Parses a decimal amount (sign allowed) into minor units. `decimal` is the decimal separator;
/// the other of `.`/`,`, spaces, apostrophes and currency symbols are treated as grouping and dropped.
/// Fails if there are more decimals than the currency allows.
pub fn parse_decimal(text: &str, currency: &str, decimal: char) -> Result<i64, &'static str> {
    let negative = text.trim_start().starts_with('-')
        || (text.trim().starts_with('(') && text.trim().ends_with(')'));
    let cleaned: String = text
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == decimal)
        .collect();
    let (int, frac) = cleaned.split_once(decimal).unwrap_or((&cleaned, ""));
    if int.is_empty() && frac.is_empty() || frac.contains(decimal) {
        return Err("amount is not a number");
    }
    let exp = exponent(currency) as usize;
    if frac.len() > exp {
        return Err("amount has too many decimals for its currency");
    }
    let digits = format!("{int}{frac:0<exp$}");
    let value: i64 = digits
        .trim_start_matches('0')
        .parse::<i64>()
        .or_else(|e| {
            if digits.chars().all(|c| c == '0') {
                Ok(0)
            } else {
                Err(e)
            }
        })
        .map_err(|_| "amount is too large")?;
    Ok(if negative { -value } else { value })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exponents_and_round_trips() {
        assert_eq!(
            (exponent("USD"), exponent("IDR"), exponent("KWD")),
            (2, 0, 3)
        );
        assert_eq!(to_decimal(123456, "USD"), "1234.56");
        assert_eq!(to_decimal(5, "USD"), "0.05");
        assert_eq!(to_decimal(7_500_000, "IDR"), "7500000");
        assert_eq!(to_decimal(1234, "KWD"), "1.234");
        for (minor, cur) in [
            (123456, "USD"),
            (7_500_000, "IDR"),
            (1234, "KWD"),
            (5, "EUR"),
        ] {
            assert_eq!(parse_decimal(&to_decimal(minor, cur), cur, '.'), Ok(minor));
        }
    }

    #[test]
    fn parses_bank_style_amounts() {
        assert_eq!(parse_decimal("1,234.5", "USD", '.'), Ok(123450));
        assert_eq!(parse_decimal("Rp 7.500.000", "IDR", ','), Ok(7_500_000));
        assert_eq!(parse_decimal("1.234,56 €", "EUR", ','), Ok(123456));
        assert_eq!(parse_decimal("-45.00", "USD", '.'), Ok(-4500));
        assert_eq!(parse_decimal("(12.00)", "USD", '.'), Ok(-1200));
        assert_eq!(parse_decimal("0.00", "USD", '.'), Ok(0));
        assert!(
            parse_decimal("1.234", "USD", '.').is_err(),
            "3 decimals for USD"
        );
        assert!(parse_decimal("abc", "USD", '.').is_err());
        assert!(parse_decimal("99999999999999999999", "USD", '.').is_err());
    }
}
