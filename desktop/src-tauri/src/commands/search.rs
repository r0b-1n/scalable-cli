use crate::sc::run_sc_command;
use serde_json::Value;

#[tauri::command]
pub async fn search_securities(
    query: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["broker", "search", &query];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
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
    let mut args = vec![
        "broker", "derivatives", "search",
        "--underlying", &underlying,
        "--type", &derivative_type,
        "--strategy", &strategy,
    ];
    if let Some(l) = limit {
        args.push("--limit");
        args.push(&l.to_string());
    }
    if let Some(o) = offset {
        args.push("--offset");
        args.push(&o.to_string());
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
    run_sc_command(&args).map_err(|e| e.to_string())
}
