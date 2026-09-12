use crate::sc::run_sc_command;
use crate::validate;
use serde_json::Value;

#[tauri::command]
pub async fn get_savings_plans(portfolio_id: Option<String>) -> Result<Value, String> {
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "savings-plans"];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_savings_plan_config(
    isin: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::isin(&isin)?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "savings-plans", "config", "--isin", &isin];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
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
    validate::isin(&isin)?;
    validate::decimal(&amount, "amount")?;
    validate::opt(&frequency, |v| validate::code(v, "frequency"))?;
    validate::opt(&year_month, |v| validate::time_like(v, "year month"))?;
    validate::opt(&dynamization_rate, |v| validate::decimal(v, "dynamization rate"))?;
    validate::opt(&payment_method, |v| validate::code(v, "payment method"))?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;
    validate::opt(&confirm, |v| validate::ident(v, "confirmation id"))?;

    // Owned string must outlive `args` (Vec<&str>).
    let day_of_month_arg = day_of_month.map(|d| d.to_string());

    let mut args = vec!["broker", "savings-plans", "add", "--isin", &isin, "--amount", &amount];
    if let Some(f) = &frequency {
        args.push("--frequency");
        args.push(f);
    }
    if let Some(d) = &day_of_month_arg {
        args.push("--day-of-month");
        args.push(d);
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
    run_sc_command(&args).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_savings_plan(
    isin: String,
    portfolio_id: Option<String>,
) -> Result<Value, String> {
    validate::isin(&isin)?;
    validate::opt(&portfolio_id, |v| validate::ident(v, "portfolio id"))?;

    let mut args = vec!["broker", "savings-plans", "remove", "--isin", &isin];
    if let Some(id) = &portfolio_id {
        args.push("--portfolio-id");
        args.push(id);
    }
    run_sc_command(&args).await.map_err(|e| e.to_string())
}
