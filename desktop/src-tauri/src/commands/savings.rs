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

/// `sc broker savings-plans add` — phase 1 previews (no `confirm`), phase 2
/// submits with the confirmation id from that preview. The frontend must show
/// the whole phase-1 ex-ante cost disclosure and take a separate affirmative
/// confirmation before calling this again with `confirm`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn add_savings_plan(
    isin: String,
    amount: String,
    frequency: Option<String>,
    day_of_month: Option<u8>,
    year_month: Option<String>,
    dynamization_rate: Option<String>,
    payment_method: Option<String>,
    appropriateness_id: Option<String>,
    acknowledged_appropriateness_warning_version: Option<String>,
    portfolio_id: Option<String>,
    confirm: Option<String>,
) -> Result<Value, String> {
    validate::isin(&isin)?;
    validate::decimal(&amount, "amount")?;
    validate::opt(&frequency, validate::savings_plan_frequency)?;
    if let Some(day) = day_of_month {
        validate::day_of_month(day)?;
    }
    validate::opt(&year_month, validate::year_month)?;
    validate::opt(&dynamization_rate, |v| validate::decimal(v, "dynamization rate"))?;
    validate::opt(&payment_method, validate::savings_plan_payment_method)?;
    validate::opt(&appropriateness_id, |v| {
        validate::ident(v, "appropriateness id")
    })?;
    validate::opt(&acknowledged_appropriateness_warning_version, |v| {
        validate::ident(v, "appropriateness warning version")
    })?;
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
    if let Some(a) = &appropriateness_id {
        args.push("--appropriateness-id");
        args.push(a);
    }
    if let Some(v) = &acknowledged_appropriateness_warning_version {
        args.push("--acknowledged-appropriateness-warning-version");
        args.push(v);
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
