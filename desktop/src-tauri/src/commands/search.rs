use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;

#[tauri::command]
pub async fn search_securities(
    query: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::text(&query, "search query", 200)?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "search", query.as_str()];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_derivatives(
    underlying: String,
    derivative_type: String,
    strategy: String,
    limit: Option<u16>,
    offset: Option<u32>,
    issuer: Option<Vec<String>>,
    leverage_min: Option<String>,
    leverage_max: Option<String>,
    knockout_barrier_min: Option<String>,
    knockout_barrier_max: Option<String>,
    strike_min: Option<String>,
    strike_max: Option<String>,
    sort_field: Option<String>,
    sort_order: Option<String>,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::isin(&underlying)?;
    validate::code(&derivative_type, "derivative type")?;
    validate::code(&strategy, "strategy")?;
    validate::opt_each(&issuer, |v| validate::text(v, "issuer", 100))?;
    validate::opt(&leverage_min, |v| validate::decimal(v, "leverage min"))?;
    validate::opt(&leverage_max, |v| validate::decimal(v, "leverage max"))?;
    validate::opt(&knockout_barrier_min, |v| validate::decimal(v, "knockout barrier min"))?;
    validate::opt(&knockout_barrier_max, |v| validate::decimal(v, "knockout barrier max"))?;
    validate::opt(&strike_min, |v| validate::decimal(v, "strike min"))?;
    validate::opt(&strike_max, |v| validate::decimal(v, "strike max"))?;
    validate::opt(&sort_field, |v| validate::code(v, "sort field"))?;
    validate::opt(&sort_order, |v| validate::code(v, "sort order"))?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    // Owned strings must outlive `args` (Vec<&str>).
    let limit_arg = limit.map(|l| l.to_string());
    let offset_arg = offset.map(|o| o.to_string());

    let mut args = vec![
        "broker", "derivatives", "search",
        "--underlying", &underlying,
        "--type", &derivative_type,
        "--strategy", &strategy,
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
    if let Some(min) = &leverage_min {
        args.push("--leverage-min");
        args.push(min);
    }
    if let Some(max) = &leverage_max {
        args.push("--leverage-max");
        args.push(max);
    }
    if let Some(min) = &knockout_barrier_min {
        args.push("--knockout-barrier-min");
        args.push(min);
    }
    if let Some(max) = &knockout_barrier_max {
        args.push("--knockout-barrier-max");
        args.push(max);
    }
    if let Some(min) = &strike_min {
        args.push("--strike-min");
        args.push(min);
    }
    if let Some(max) = &strike_max {
        args.push("--strike-max");
        args.push(max);
    }
    if let Some(f) = &sort_field {
        args.push("--sort-field");
        args.push(f);
    }
    if let Some(o) = &sort_order {
        args.push("--sort-order");
        args.push(o);
    }
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}
