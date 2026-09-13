use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;

#[tauri::command]
pub async fn get_watchlist(
    portfolio_id: Option<String>,
    include_year_to_date: Option<bool>,
    quote_source: Option<String>,
) -> Result<Value, String> {
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;
    validate::opt(&quote_source, |v| validate::code(v, "quote source"))?;

    let mut args = vec!["broker", "watchlist"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    // `--include-year-to-date` / `--quote-source` are list-only flags: the CLI
    // rejects them alongside the `add`/`remove` subcommands, so they stay here.
    if include_year_to_date.unwrap_or(false) {
        args.push("--include-year-to-date");
    }
    if let Some(qs) = &quote_source {
        args.push("--quote-source");
        args.push(qs);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_to_watchlist(isin: String, portfolio_id: Option<String>) -> Result<Value, String> {
    validate::isin(&isin)?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "watchlist", "add", "--isin", &isin];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_from_watchlist(
    isin: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::isin(&isin)?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "watchlist", "remove", "--isin", &isin];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}
