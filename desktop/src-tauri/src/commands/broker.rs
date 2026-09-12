use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;

#[tauri::command]
pub async fn get_broker_overview(portfolio_id: Option<String>) -> Result<Value, String> {
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "overview"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_broker_analytics(portfolio_id: Option<String>) -> Result<Value, String> {
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "analytics"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_broker_cash_breakdown(portfolio_id: Option<String>) -> Result<Value, String> {
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "cash-breakdown"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_holdings(
    portfolio_id: Option<String>,
    include_year_to_date: Option<bool>,
) -> Result<Value, String> {
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "holdings"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    if include_year_to_date.unwrap_or(false) {
        args.push("--include-year-to-date");
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_portfolio_groups(
    portfolio_id: Option<String>,
    group_id: Option<String>,
) -> Result<Value, String> {
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;
    validate::opt(&group_id, |v| validate::ident(v, "group id"))?;

    let mut args = vec!["broker", "portfolio-groups"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    if let Some(gid) = &group_id {
        args.push("--group-id");
        args.push(gid);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_portfolio_group(
    name: String,
    description: Option<String>,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::text(&name, "group name", 100)?;
    validate::opt(&description, |v| validate::text(v, "group description", 500))?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "portfolio-groups", "create", "--name", &name];
    if let Some(desc) = &description {
        args.push("--description");
        args.push(desc);
    }
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_portfolio_group(
    group_id: String,
    name: Option<String>,
    description: Option<String>,
    clear_description: Option<bool>,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::ident(&group_id, "group id")?;
    validate::opt(&name, |v| validate::text(v, "group name", 100))?;
    validate::opt(&description, |v| validate::text(v, "group description", 500))?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "portfolio-groups", "update", "--group-id", &group_id];
    if let Some(n) = &name {
        args.push("--name");
        args.push(n);
    }
    if let Some(desc) = &description {
        args.push("--description");
        args.push(desc);
    }
    if clear_description.unwrap_or(false) {
        args.push("--clear-description");
    }
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_portfolio_group(
    group_id: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::ident(&group_id, "group id")?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "portfolio-groups", "delete", "--group-id", &group_id];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn assign_to_group(
    group_id: String,
    isin: Vec<String>,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::ident(&group_id, "group id")?;
    if isin.is_empty() || isin.len() > 100 {
        return Err("Invalid ISIN list".to_string());
    }
    for i in &isin {
        validate::isin(i)?;
    }
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "portfolio-groups", "assign", "--group-id", &group_id];
    for i in &isin {
        args.push("--isin");
        args.push(i);
    }
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unassign_from_group(
    group_id: String,
    isin: Vec<String>,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::ident(&group_id, "group id")?;
    if isin.is_empty() || isin.len() > 100 {
        return Err("Invalid ISIN list".to_string());
    }
    for i in &isin {
        validate::isin(i)?;
    }
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "portfolio-groups", "unassign", "--group-id", &group_id];
    for i in &isin {
        args.push("--isin");
        args.push(i);
    }
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}
