use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;

// `sc broker trade buy|sell` deliberately take NO `--portfolio-id`: trading
// always targets the persisted broker context, so a money-moving command can
// never be aimed at another portfolio by an ambient override. Passing one is
// rejected by the CLI ("unexpected argument"), so these commands must not
// forward a portfolio id even if the frontend has one selected.
//
// The two sides are also not symmetric, and the CLI enforces that:
//   buy  — `--amount` OR `--shares` (whole shares), and `--accept-unsuitable`
//          on phase 2 when phase 1 flagged the instrument as unsuitable.
//   sell — `--shares` only (fractional allowed), and no `--accept-unsuitable`.
// Mirroring the real per-side shape here keeps invalid argv off the boundary
// instead of relying on the CLI to reject it.

fn push_optional<'a>(args: &mut Vec<&'a str>, flag: &'a str, value: &'a Option<String>) {
    if let Some(v) = value {
        args.push(flag);
        args.push(v);
    }
}

/// Phase 1 preview for either side. `amount` is buy-only; a sell must size
/// with `shares`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn trade_preview(
    side: String,
    isin: String,
    amount: Option<String>,
    shares: Option<String>,
    order_type: Option<String>,
    limit_price: Option<String>,
    stop_price: Option<String>,
    venue: Option<String>,
) -> Result<Value, String> {
    validate::side(&side)?;
    validate::isin(&isin)?;
    validate::opt(&amount, |v| validate::decimal(v, "amount"))?;
    validate::opt(&shares, |v| validate::decimal(v, "shares"))?;
    validate::opt(&order_type, validate::order_type)?;
    validate::opt(&limit_price, |v| validate::decimal(v, "limit price"))?;
    validate::opt(&stop_price, |v| validate::decimal(v, "stop price"))?;
    validate::opt(&venue, |v| validate::code(v, "venue"))?;
    if side == "sell" && amount.is_some() {
        return Err("Sell orders must be sized in shares, not an amount".to_string());
    }

    let mut args = vec!["broker", "trade", side.as_str(), "--isin", &isin];
    push_optional(&mut args, "--amount", &amount);
    push_optional(&mut args, "--shares", &shares);
    push_optional(&mut args, "--order-type", &order_type);
    push_optional(&mut args, "--limit-price", &limit_price);
    push_optional(&mut args, "--stop-price", &stop_price);
    push_optional(&mut args, "--venue", &venue);
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

/// Phase 2. Repeats the exact phase-1 arguments plus `--confirm <id>`, and is
/// only ever called after a separate affirmative user confirmation.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn trade_submit(
    side: String,
    confirmation_id: String,
    isin: Option<String>,
    amount: Option<String>,
    shares: Option<String>,
    order_type: Option<String>,
    limit_price: Option<String>,
    stop_price: Option<String>,
    venue: Option<String>,
    accept_unsuitable: Option<bool>,
) -> Result<Value, String> {
    validate::side(&side)?;
    validate::ident(&confirmation_id, "confirmation id")?;
    validate::opt(&isin, validate::isin)?;
    validate::opt(&amount, |v| validate::decimal(v, "amount"))?;
    validate::opt(&shares, |v| validate::decimal(v, "shares"))?;
    validate::opt(&order_type, validate::order_type)?;
    validate::opt(&limit_price, |v| validate::decimal(v, "limit price"))?;
    validate::opt(&stop_price, |v| validate::decimal(v, "stop price"))?;
    validate::opt(&venue, |v| validate::code(v, "venue"))?;
    if side == "sell" && amount.is_some() {
        return Err("Sell orders must be sized in shares, not an amount".to_string());
    }
    if side == "sell" && accept_unsuitable.unwrap_or(false) {
        return Err("--accept-unsuitable applies to buy orders only".to_string());
    }

    let mut args = vec!["broker", "trade", side.as_str()];
    push_optional(&mut args, "--isin", &isin);
    push_optional(&mut args, "--amount", &amount);
    push_optional(&mut args, "--shares", &shares);
    push_optional(&mut args, "--order-type", &order_type);
    push_optional(&mut args, "--limit-price", &limit_price);
    push_optional(&mut args, "--stop-price", &stop_price);
    push_optional(&mut args, "--venue", &venue);
    args.push("--confirm");
    args.push(&confirmation_id);
    // Buy-only: the CLI rejects this flag on a sell.
    if side == "buy" && accept_unsuitable.unwrap_or(false) {
        args.push("--accept-unsuitable");
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

/// Single-step cancel for a pending order. Unlike buy/sell this one DOES take
/// `--portfolio-id`.
#[tauri::command]
pub async fn trade_cancel(
    order_id: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::ident(&order_id, "order id")?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "trade", "cancel", "--order-id", &order_id];
    push_optional(&mut args, "--portfolio-id", &portfolio_id);
    run_sc_command(&args).await.map_err(|e| e.to_string())
}
