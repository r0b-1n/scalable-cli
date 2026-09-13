use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_transactions(
    portfolio_id: Option<String>,
    page_size: Option<u16>,
    cursor: Option<String>,
    type_filter: Option<Vec<String>>,
    status: Option<Vec<String>>,
    search_term: Option<String>,
    isin: Option<String>,
    from_time: Option<String>,
    to_time: Option<String>,
    include_reinvestment_subtypes: Option<bool>,
) -> Result<Value, String> {
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;
    validate::opt(&cursor, |v| validate::ident(v, "cursor"))?;
    validate::opt_each(&type_filter, |v| validate::code(v, "type filter"))?;
    validate::opt_each(&status, |v| validate::code(v, "status"))?;
    validate::opt(&search_term, |v| validate::text(v, "search term", 200))?;
    validate::opt(&isin, validate::isin)?;
    validate::opt(&from_time, |v| validate::time_like(v, "from time"))?;
    validate::opt(&to_time, |v| validate::time_like(v, "to time"))?;

    // Owned string must outlive `args` (Vec<&str>).
    let page_size_arg = page_size.map(|ps| ps.to_string());

    let mut args = vec!["broker", "transactions"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    if let Some(ps) = &page_size_arg {
        args.push("--page-size");
        args.push(ps);
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
    if let Some(ft) = &from_time {
        args.push("--from-time");
        args.push(ft);
    }
    if let Some(tt) = &to_time {
        args.push("--to-time");
        args.push(tt);
    }
    if include_reinvestment_subtypes.unwrap_or(false) {
        args.push("--include-reinvestment-subtypes");
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_transaction_detail(
    transaction_id: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::ident(&transaction_id, "transaction id")?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "transaction", "details", "--transaction-id", &transaction_id];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}
