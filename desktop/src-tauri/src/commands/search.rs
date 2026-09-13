use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;

#[tauri::command]
pub async fn search_securities(
    query: String,
    portfolio_id: Option<String>,
    include_year_to_date: Option<bool>,
    quote_source: Option<String>,
) -> Result<Value, String> {
    validate::text(&query, "search query", 200)?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;
    validate::opt(&quote_source, |v| validate::code(v, "quote source"))?;

    let mut args = vec!["broker", "search", query.as_str()];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    if include_year_to_date.unwrap_or(false) {
        args.push("--include-year-to-date");
    }
    if let Some(qs) = &quote_source {
        args.push("--quote-source");
        args.push(qs);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

/// Every filter `sc broker derivatives search` accepts. The enum-valued flags
/// are checked against the CLI's own `ValueEnum` spellings here rather than
/// the generic `code()` shape check, so a compromised renderer cannot smuggle
/// an unexpected value past the IPC boundary.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn search_derivatives(
    underlying: String,
    derivative_type: String,
    strategy: String,
    limit: Option<u16>,
    offset: Option<u32>,
    issuer: Option<Vec<String>>,
    product_subcategory: Option<Vec<String>>,
    leverage_min: Option<String>,
    leverage_max: Option<String>,
    knockout_barrier_min: Option<String>,
    knockout_barrier_max: Option<String>,
    strike_min: Option<String>,
    strike_max: Option<String>,
    omega_min: Option<String>,
    omega_max: Option<String>,
    delta_min: Option<String>,
    delta_max: Option<String>,
    factor_min: Option<String>,
    factor_max: Option<String>,
    expiry_from: Option<String>,
    expiry_to: Option<String>,
    sort_field: Option<String>,
    sort_order: Option<String>,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::isin(&underlying)?;
    validate::derivative_type(&derivative_type)?;
    validate::derivative_strategy(&strategy)?;
    validate::opt_each(&issuer, validate::derivative_issuer)?;
    validate::opt_each(&product_subcategory, validate::derivative_subcategory)?;
    validate::opt(&leverage_min, |v| validate::decimal(v, "leverage min"))?;
    validate::opt(&leverage_max, |v| validate::decimal(v, "leverage max"))?;
    validate::opt(&knockout_barrier_min, |v| {
        validate::decimal(v, "knockout barrier min")
    })?;
    validate::opt(&knockout_barrier_max, |v| {
        validate::decimal(v, "knockout barrier max")
    })?;
    validate::opt(&strike_min, |v| validate::decimal(v, "strike min"))?;
    validate::opt(&strike_max, |v| validate::decimal(v, "strike max"))?;
    // Omega and delta are signed: put/short derivatives report negative values.
    validate::opt(&omega_min, |v| validate::signed_decimal(v, "omega min"))?;
    validate::opt(&omega_max, |v| validate::signed_decimal(v, "omega max"))?;
    validate::opt(&delta_min, |v| validate::signed_decimal(v, "delta min"))?;
    validate::opt(&delta_max, |v| validate::signed_decimal(v, "delta max"))?;
    validate::opt(&factor_min, |v| validate::signed_decimal(v, "factor min"))?;
    validate::opt(&factor_max, |v| validate::signed_decimal(v, "factor max"))?;
    validate::opt(&expiry_from, |v| validate::date(v, "expiry from"))?;
    validate::opt(&expiry_to, |v| validate::date(v, "expiry to"))?;
    validate::opt(&sort_field, validate::derivative_sort_field)?;
    validate::opt(&sort_order, validate::sort_order)?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    // Owned strings must outlive `args` (Vec<&str>).
    let limit_arg = limit.map(|l| l.to_string());
    let offset_arg = offset.map(|o| o.to_string());

    let mut args = vec![
        "broker",
        "derivatives",
        "search",
        "--underlying",
        &underlying,
        "--type",
        &derivative_type,
        "--strategy",
        &strategy,
    ];
    if let Some(l) = &limit_arg {
        args.push("--limit");
        args.push(l);
    }
    if let Some(o) = &offset_arg {
        args.push("--offset");
        args.push(o);
    }
    if let Some(issuers) = &issuer {
        for i in issuers {
            args.push("--issuer");
            args.push(i);
        }
    }
    if let Some(subcategories) = &product_subcategory {
        for s in subcategories {
            args.push("--product-subcategory");
            args.push(s);
        }
    }
    for (flag, value) in [
        ("--leverage-min", &leverage_min),
        ("--leverage-max", &leverage_max),
        ("--knockout-barrier-min", &knockout_barrier_min),
        ("--knockout-barrier-max", &knockout_barrier_max),
        ("--strike-min", &strike_min),
        ("--strike-max", &strike_max),
        ("--omega-min", &omega_min),
        ("--omega-max", &omega_max),
        ("--delta-min", &delta_min),
        ("--delta-max", &delta_max),
        ("--factor-min", &factor_min),
        ("--factor-max", &factor_max),
        ("--expiry-from", &expiry_from),
        ("--expiry-to", &expiry_to),
        ("--sort-field", &sort_field),
        ("--sort-order", &sort_order),
        ("--portfolio-id", &portfolio_id),
    ] {
        if let Some(v) = value {
            args.push(flag);
            args.push(v);
        }
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}
