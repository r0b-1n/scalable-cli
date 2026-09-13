//! Input validation at the IPC trust boundary.
//!
//! Every string the webview hands to a Tauri command is validated here
//! before it becomes an `sc` argv entry. The CLI's clap layer re-validates
//! most of it, but the desktop backend must not rely on that alone: a
//! compromised renderer should not be able to drive arbitrary CLI shapes.

/// Trade side: the only two values the UI can produce.
pub fn side(value: &str) -> Result<(), String> {
    one_of(value, &["buy", "sell"], "side")
}

/// Order type as accepted by `sc broker trade --order-type`.
pub fn order_type(value: &str) -> Result<(), String> {
    one_of(value, &["market", "limit", "stop"], "order type")
}

/// Chart timeframe as accepted by `sc broker chart --timeframe`.
pub fn timeframe(value: &str) -> Result<(), String> {
    one_of(
        value,
        &["1d", "7d", "1m", "3m", "6m", "ytd", "1y", "max"],
        "timeframe",
    )
}

/// Savings-plan frequency as accepted by `sc broker savings-plans add --frequency`.
pub fn savings_plan_frequency(value: &str) -> Result<(), String> {
    one_of(
        value,
        &[
            "monthly",
            "bi-monthly",
            "quarterly",
            "semi-annually",
            "annually",
        ],
        "frequency",
    )
}

/// Savings-plan payment method as accepted by `--payment-method`.
pub fn savings_plan_payment_method(value: &str) -> Result<(), String> {
    one_of(
        value,
        &[
            "reference-account",
            "buying-power-with-reference-account-fallback",
        ],
        "payment method",
    )
}

/// Derivative product type as accepted by `sc broker derivatives search --type`.
pub fn derivative_type(value: &str) -> Result<(), String> {
    one_of(value, &["knockout", "warrant", "factor"], "derivative type")
}

/// Derivative strategy as accepted by `--strategy`.
pub fn derivative_strategy(value: &str) -> Result<(), String> {
    one_of(value, &["long", "short", "put", "call"], "strategy")
}

/// Derivative issuer as accepted by `--issuer` (repeatable).
pub fn derivative_issuer(value: &str) -> Result<(), String> {
    one_of(
        value,
        &[
            "goldman-sachs",
            "hsbc",
            "hvb",
            "bnp",
            "vontobel",
            "morgan-stanley",
            "soc-gen",
        ],
        "issuer",
    )
}

/// Knockout product subcategory as accepted by `--product-subcategory`.
pub fn derivative_subcategory(value: &str) -> Result<(), String> {
    one_of(value, &["mini-future", "turbo"], "product subcategory")
}

/// Derivative sort field as accepted by `--sort-field`.
pub fn derivative_sort_field(value: &str) -> Result<(), String> {
    one_of(
        value,
        &[
            "strike",
            "leverage",
            "expiry-date",
            "knockout-barrier",
            "distance-to-knockout",
            "premium-absolute",
            "premium-relative",
            "distance-to-strike",
            "omega",
            "delta",
            "implied-volatility",
            "factor",
        ],
        "sort field",
    )
}

/// Sort order as accepted by `--sort-order`.
pub fn sort_order(value: &str) -> Result<(), String> {
    one_of(value, &["asc", "desc"], "sort order")
}

/// Day of month as accepted by `sc broker savings-plans add --day-of-month`
/// (clap range `1..=31`).
pub fn day_of_month(value: u8) -> Result<(), String> {
    if (1..=31).contains(&value) {
        Ok(())
    } else {
        Err("Invalid day of month: expected 1–31".to_string())
    }
}

/// `YYYY-MM` calendar month as accepted by `--year-month`.
pub fn year_month(value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    let ok = bytes.len() == 7
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..].iter().all(u8::is_ascii_digit)
        && matches!(&value[5..], "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12");
    if ok {
        Ok(())
    } else {
        Err("Invalid year-month: expected YYYY-MM".to_string())
    }
}

/// `YYYY-MM-DD` calendar date as accepted by `--expiry-from` / `--expiry-to`.
pub fn date(value: &str, name: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    let shape = bytes.len() == 10
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..].iter().all(u8::is_ascii_digit);
    if !shape {
        return Err(format!("Invalid {name}: expected YYYY-MM-DD"));
    }
    let month: u8 = value[5..7].parse().map_err(|_| format!("Invalid {name}"))?;
    let day: u8 = value[8..].parse().map_err(|_| format!("Invalid {name}"))?;
    if (1..=12).contains(&month) && (1..=31).contains(&day) {
        Ok(())
    } else {
        Err(format!("Invalid {name}: expected YYYY-MM-DD"))
    }
}

/// Signed decimal (derivative delta/omega bounds can be negative).
pub fn signed_decimal(value: &str, name: &str) -> Result<(), String> {
    let body = value.strip_prefix('-').unwrap_or(value);
    decimal(body, name)
}

/// News locale: the UI only ever requests these two.
pub fn locale(value: &str) -> Result<(), String> {
    one_of(value, &["de_DE", "en_DE"], "locale")
}

/// ISIN: two letters, nine alphanumerics, one check digit (ISO 6166).
pub fn isin(value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    let ok = bytes.len() == 12
        && bytes[..2].iter().all(u8::is_ascii_uppercase)
        && bytes[2..11]
            .iter()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        && bytes[11].is_ascii_digit();
    if ok {
        Ok(())
    } else {
        Err("Invalid ISIN format".to_string())
    }
}

/// Unsigned decimal amount/price/rate: digits with an optional fraction.
pub fn decimal(value: &str, name: &str) -> Result<(), String> {
    let mut parts = value.splitn(2, '.');
    let int = parts.next().unwrap_or("");
    let frac = parts.next();
    let int_ok = !int.is_empty() && int.len() <= 12 && int.bytes().all(|b| b.is_ascii_digit());
    let frac_ok = match frac {
        None => true,
        Some(f) => !f.is_empty() && f.len() <= 8 && f.bytes().all(|b| b.is_ascii_digit()),
    };
    if int_ok && frac_ok {
        Ok(())
    } else {
        Err(format!("Invalid {name}: expected a positive decimal number"))
    }
}

/// Opaque identifier from a previous API response (portfolio id, order id,
/// confirmation id, cursor, …): printable token, no whitespace, bounded.
pub fn ident(value: &str, name: &str) -> Result<(), String> {
    let ok = !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':' | b'+' | b'/' | b'='));
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid {name}"))
    }
}

/// Short enum-like code (transaction type filter, status, frequency,
/// derivative type, strategy, sort field/order, payment method, ticker).
/// The CLI enforces the actual value set; this bounds shape and length.
pub fn code(value: &str, name: &str) -> Result<(), String> {
    let ok = !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'));
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid {name}"))
    }
}

/// Free text (search query, group name/description): bounded length,
/// no control characters.
pub fn text(value: &str, name: &str, max: usize) -> Result<(), String> {
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        Err(format!("Invalid {name}: must be 1–{max} characters without control characters"))
    } else {
        Ok(())
    }
}

/// Timestamp-ish argument (`--from-time`/`--to-time`, `--year-month`):
/// RFC 3339 / YYYY-MM shaped charset, bounded.
pub fn time_like(value: &str, name: &str) -> Result<(), String> {
    let ok = !value.is_empty()
        && value.len() <= 40
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'-' | b':' | b'.' | b'+' | b'T' | b'Z'));
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid {name}"))
    }
}

pub fn one_of(value: &str, allowed: &[&str], name: &str) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("Invalid {name}: expected one of {}", allowed.join(", ")))
    }
}

/// Validate an optional value with the given check.
pub fn opt<F>(value: &Option<String>, check: F) -> Result<(), String>
where
    F: Fn(&str) -> Result<(), String>,
{
    match value {
        Some(v) => check(v),
        None => Ok(()),
    }
}

/// Validate every entry of an optional list with the given check.
pub fn opt_each<F>(values: &Option<Vec<String>>, check: F) -> Result<(), String>
where
    F: Fn(&str) -> Result<(), String>,
{
    if let Some(items) = values {
        if items.len() > 32 {
            return Err("Too many filter values".to_string());
        }
        for v in items {
            check(v)?;
        }
    }
    Ok(())
}
