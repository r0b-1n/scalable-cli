use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;

#[tauri::command]
pub async fn get_overnight(savings_account_id: Option<String>) -> Result<Value, String> {
    validate::opt(&savings_account_id, |v| validate::ident(v, "savings account id"))?;

    let mut args = vec!["overnight"];
    if let Some(id) = &savings_account_id {
        args.push("--savings-account-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_overnight_transactions(
    savings_account_id: Option<String>,
    page_size: Option<u16>,
    cursor: Option<String>,
    type_filter: Option<Vec<String>>,
    search_term: Option<String>,
    from_time: Option<String>,
    to_time: Option<String>,
) -> Result<Value, String> {
    validate::opt(&savings_account_id, |v| validate::ident(v, "savings account id"))?;
    validate::opt(&cursor, |v| validate::ident(v, "cursor"))?;
    validate::opt_each(&type_filter, |v| validate::code(v, "type filter"))?;
    validate::opt(&search_term, |v| validate::text(v, "search term", 200))?;
    validate::opt(&from_time, |v| validate::time_like(v, "from time"))?;
    validate::opt(&to_time, |v| validate::time_like(v, "to time"))?;

    // Owned string must outlive `args` (Vec<&str>).
    let page_size_arg = page_size.map(|ps| ps.to_string());

    let mut args = vec!["overnight", "transactions"];
    if let Some(id) = &savings_account_id {
        args.push("--savings-account-id");
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
    if let Some(term) = &search_term {
        args.push("--search-term");
        args.push(term);
    }
    if let Some(ft) = &from_time {
        args.push("--from-time");
        args.push(ft);
    }
    if let Some(tt) = &to_time {
        args.push("--to-time");
        args.push(tt);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}
