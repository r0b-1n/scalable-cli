mod commands;
mod sc;
mod validate;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::auth::login,
            commands::auth::logout,
            commands::auth::get_whoami,
            commands::auth::get_capabilities,
            commands::context::get_broker_context,
            commands::context::list_broker_portfolios,
            commands::context::select_broker_context,
            commands::broker::get_broker_overview,
            commands::broker::get_broker_analytics,
            commands::broker::get_broker_cash_breakdown,
            commands::broker::get_holdings,
            commands::broker::get_portfolio_groups,
            commands::broker::create_portfolio_group,
            commands::broker::update_portfolio_group,
            commands::broker::delete_portfolio_group,
            commands::broker::assign_to_group,
            commands::broker::unassign_from_group,
            commands::transactions::get_transactions,
            commands::transactions::get_transaction_detail,
            commands::market::get_quote,
            commands::market::get_chart,
            commands::market::get_security_news,
            commands::watchlist::get_watchlist,
            commands::watchlist::add_to_watchlist,
            commands::watchlist::remove_from_watchlist,
            commands::alerts::get_price_alerts,
            commands::alerts::add_price_alert,
            commands::alerts::remove_price_alert,
            commands::savings::get_savings_plans,
            commands::savings::get_savings_plan_config,
            commands::savings::add_savings_plan,
            commands::savings::remove_savings_plan,
            commands::search::search_securities,
            commands::search::search_derivatives,
            commands::trading::trade_preview,
            commands::trading::trade_submit,
            commands::trading::trade_cancel,
            commands::overnight::get_overnight,
            commands::overnight::get_overnight_transactions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scalable Desktop");
}
