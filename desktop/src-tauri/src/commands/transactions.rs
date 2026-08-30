use crate::sc::run_sc_command;
use serde_json::Value;

#[tauri::command]
pub async fn get_transactions(
    portfolio_id: Option<String>,
    page_size: Option<u16>,
    cursor: Option<String>,
    type_filter: Option<Vec<String>>,
    status: Option<Vec<String>>,
    search_term: Option<String>,
    isin: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["broker", "transactions"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    if let Some(ps) = page_size {
        args.push("--page-size");
        args.push(&ps.to_string());
    }
    if let Some(c) = &cursor {
        args.push("--cursor");
        args.push(c);
    }
    if let Some(filters) = &type_filter {
        for f in filters {
            args.push("--type-filter");
            args.push(f);
        }
    }
    if let Some(s) = &status {
        for st in s {
            args.push("--status");
            args.push(st);
        }
    }
    if let Some(term) = &search_term {
        args.push("--search-term");
        args.push(term);
    }
    if let Some(i) = &isin {
        args.push("--isin");
        args.push(i);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_transaction_detail(
    transaction_id: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["broker", "transaction", "details", "--transaction-id", &transaction_id];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}
