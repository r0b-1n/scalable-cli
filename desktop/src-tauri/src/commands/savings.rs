use crate::sc::run_sc_command;
use serde_json::Value;

#[tauri::command]
pub async fn get_savings_plans(portfolio_id: Option<String>) -> Result<Value, String> {
    let mut args = vec!["broker", "savings-plans"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_savings_plan_config(
    isin: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["broker", "savings-plans", "config", "--isin", &isin];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_savings_plan(
    isin: String,
    amount: String,
    frequency: Option<String>,
    day_of_month: Option<u8>,
    year_month: Option<String>,
    dynamization_rate: Option<String>,
    payment_method: Option<String>,
    portfolio_id: Option<String>,
    confirm: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["broker", "savings-plans", "add", "--isin", &isin, "--amount", &amount];
    if let Some(f) = &frequency {
        args.push("--frequency");
        args.push(f);
    }
    if let Some(d) = day_of_month {
        args.push("--day-of-month");
        args.push(&d.to_string());
    }
    if let Some(ym) = &year_month {
        args.push("--year-month");
        args.push(ym);
    }
    if let Some(dr) = &dynamization_rate {
        args.push("--dynamization-rate");
        args.push(dr);
    }
    if let Some(pm) = &payment_method {
        args.push("--payment-method");
        args.push(pm);
    }
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    if let Some(c) = &confirm {
        args.push("--confirm");
        args.push(c);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_savings_plan(
    isin: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    let mut args = vec!["broker", "savings-plans", "remove", "--isin", &isin];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).map_err(|e| e.to_string())
}
