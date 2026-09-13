//! The mock's instrument universe: a fixed, realistic set of securities that everything else
//! (holdings, watchlist, search, quotes, charts, derivatives) is drawn from.
//!
//! All data is `'static` and built once behind a [`std::sync::OnceLock`] — there is no per-seed
//! variation *in the catalog itself* (the seed only affects generated prices/paths in
//! `pricing.rs`), so the instrument universe is identical across runs and seeds by design.


use std::sync::OnceLock;

/// A single tradable instrument in the mock's universe.
#[derive(Clone, Copy, Debug)]
pub struct Instrument {
    pub isin: &'static str,
    pub wkn: &'static str,
    pub symbol: &'static str,
    pub name: &'static str,
    /// "EQ" | "ETF" | "FND" | "CRYPTO" | "BND" | "KNOCKOUT" | "WARRANT" | "FACTOR"
    pub security_type: &'static str,
    /// "EQUITY" | "BOND" | "CRYPTO" | "COMMODITY" | "CASH" | "MULTI_ASSET"
    pub asset_class: &'static str,
    /// GICS-ish sector; "DIVERSIFIED" for funds and crypto (no single-sector classification).
    pub sector: &'static str,
    /// "NORTH_AMERICA" | "EUROPE" | "GERMANY" | "ASIA_PACIFIC" | "EMERGING" | "GLOBAL"
    pub region: &'static str,
    /// "EUR" | "USD"
    pub currency: &'static str,
    /// Reference price the price series in `pricing.rs` is generated around.
    pub base_price: f64,
    /// Annualized volatility (e.g. 0.16 broad ETF, 0.28 single equity, 0.65 crypto).
    pub annual_vol: f64,
    /// Annualized drift used by the GBM walk in `pricing.rs`.
    pub annual_drift: f64,
    /// 0.0 for accumulating ETFs / non-payers.
    pub dividend_yield: f64,
    pub distributing: bool,
    /// Fund total expense ratio; 0.0 for single stocks and derivatives.
    pub ter: f64,
    pub venues: &'static [&'static str],
    pub savings_plan_eligible: bool,
    pub is_derivative: bool,
    /// `Some(isin)` for knockouts/warrants/factor certificates; `None` otherwise. Read by
    /// `derivatives_on` below; the derivatives-search handler currently generates its own
    /// synthetic ladder per underlying rather than looking up these five fixed catalog entries,
    /// so this field has no other live reader yet.
    #[allow(dead_code)]
    pub underlying_isin: Option<&'static str>,
}

/// Frequently reused venue lists.
const XETR_GETTEX: &[&str] = &["XETR", "GETTEX"];
const GETTEX_ONLY: &[&str] = &["GETTEX"];
const CRYPTO_VENUE: &[&str] = &["CRYPTO"];

/// The full, fixed instrument universe (built once, then reused for the process lifetime).
pub fn catalog() -> &'static [Instrument] {
    static CATALOG: OnceLock<Vec<Instrument>> = OnceLock::new();
    CATALOG.get_or_init(build_catalog).as_slice()
}

/// Look up a single instrument by ISIN (case-insensitive).
pub fn find(isin: &str) -> Option<&'static Instrument> {
    catalog().iter().find(|i| i.isin.eq_ignore_ascii_case(isin))
}

/// All instruments whose `asset_class` matches (case-insensitive).
pub fn by_asset_class(asset_class: &str) -> Vec<&'static Instrument> {
    catalog()
        .iter()
        .filter(|i| i.asset_class.eq_ignore_ascii_case(asset_class))
        .collect()
}

/// All instruments whose `security_type` matches (case-insensitive). Not currently called by any
/// handler (analytics/holdings group by `asset_class` instead) — kept as public catalog surface
/// for a future security-type filter.
#[allow(dead_code)]
pub fn by_security_type(security_type: &str) -> Vec<&'static Instrument> {
    catalog()
        .iter()
        .filter(|i| i.security_type.eq_ignore_ascii_case(security_type))
        .collect()
}

/// Free-text search over name, ISIN, symbol, and WKN (case-insensitive substring match) — the
/// shape `sc broker search <query>` needs against `simpleSecuritySearch`.
pub fn search(term: &str) -> Vec<&'static Instrument> {
    let needle = term.to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    catalog()
        .iter()
        .filter(|i| {
            i.name.to_lowercase().contains(&needle)
                || i.isin.to_lowercase().contains(&needle)
                || i.symbol.to_lowercase().contains(&needle)
                || i.wkn.to_lowercase().contains(&needle)
        })
        .collect()
}

/// Look up a single instrument by its trading symbol/ticker (case-insensitive) — used for crypto
/// coins, which are addressed by ticker (`BTC`, `ETH`, ...) rather than ISIN in several GraphQL
/// operations (price alerts, savings plans).
pub fn find_by_symbol(symbol: &str) -> Option<&'static Instrument> {
    catalog().iter().find(|i| i.symbol.eq_ignore_ascii_case(symbol))
}

/// All derivatives (knockouts/warrants/factor certificates) whose `underlying_isin` matches. Not
/// currently called by any handler — `BrokerDerivativesSearch` generates its own synthetic ladder
/// per underlying (see `graphql::generate_derivative_ladder`) rather than the five fixed catalog
/// derivative entries this looks up; kept as public catalog surface for a future consumer.
#[allow(dead_code)]
pub fn derivatives_on(underlying_isin: &str) -> Vec<&'static Instrument> {
    catalog()
        .iter()
        .filter(|i| i.is_derivative && i.underlying_isin == Some(underlying_isin))
        .collect()
}

fn build_catalog() -> Vec<Instrument> {
    vec![
        // ---- German blue chips (EQ, GERMANY, EUR) ----------------------------------------
        Instrument {
            isin: "DE0007164600", wkn: "716460", symbol: "SAP", name: "SAP SE",
            security_type: "EQ", asset_class: "EQUITY", sector: "INFORMATION_TECHNOLOGY",
            region: "GERMANY", currency: "EUR", base_price: 210.40, annual_vol: 0.22,
            annual_drift: 0.06, dividend_yield: 0.013, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "DE0007236101", wkn: "723610", symbol: "SIE", name: "Siemens AG",
            security_type: "EQ", asset_class: "EQUITY", sector: "INDUSTRIALS",
            region: "GERMANY", currency: "EUR", base_price: 195.80, annual_vol: 0.24,
            annual_drift: 0.05, dividend_yield: 0.028, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "DE0008404005", wkn: "840400", symbol: "ALV", name: "Allianz SE",
            security_type: "EQ", asset_class: "EQUITY", sector: "FINANCIALS",
            region: "GERMANY", currency: "EUR", base_price: 305.20, annual_vol: 0.20,
            annual_drift: 0.05, dividend_yield: 0.038, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "DE0007100000", wkn: "710000", symbol: "MBG", name: "Mercedes-Benz Group AG",
            security_type: "EQ", asset_class: "EQUITY", sector: "CONSUMER_DISCRETIONARY",
            region: "GERMANY", currency: "EUR", base_price: 58.40, annual_vol: 0.30,
            annual_drift: 0.01, dividend_yield: 0.070, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "DE0007030009", wkn: "703000", symbol: "RHM", name: "Rheinmetall AG",
            security_type: "EQ", asset_class: "EQUITY", sector: "INDUSTRIALS",
            region: "GERMANY", currency: "EUR", base_price: 1650.00, annual_vol: 0.40,
            annual_drift: 0.15, dividend_yield: 0.008, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "DE0005557508", wkn: "555750", symbol: "DTE", name: "Deutsche Telekom AG",
            security_type: "EQ", asset_class: "EQUITY", sector: "COMMUNICATION_SERVICES",
            region: "GERMANY", currency: "EUR", base_price: 28.50, annual_vol: 0.18,
            annual_drift: 0.04, dividend_yield: 0.034, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "NL0000235190", wkn: "938914", symbol: "AIR", name: "Airbus SE",
            security_type: "EQ", asset_class: "EQUITY", sector: "INDUSTRIALS",
            region: "EUROPE", currency: "EUR", base_price: 165.30, annual_vol: 0.27,
            annual_drift: 0.07, dividend_yield: 0.014, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "DE000BASF111", wkn: "BASF11", symbol: "BAS", name: "BASF SE",
            security_type: "EQ", asset_class: "EQUITY", sector: "MATERIALS",
            region: "GERMANY", currency: "EUR", base_price: 47.10, annual_vol: 0.25,
            annual_drift: 0.01, dividend_yield: 0.066, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "DE0007664039", wkn: "766403", symbol: "VOW3", name: "Volkswagen AG (Vz)",
            security_type: "EQ", asset_class: "EQUITY", sector: "CONSUMER_DISCRETIONARY",
            region: "GERMANY", currency: "EUR", base_price: 92.00, annual_vol: 0.29,
            annual_drift: 0.0, dividend_yield: 0.060, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "DE0008430026", wkn: "843002", symbol: "MUV2", name: "Muenchener Rueckversicherungs-Gesellschaft AG",
            security_type: "EQ", asset_class: "EQUITY", sector: "FINANCIALS",
            region: "GERMANY", currency: "EUR", base_price: 495.60, annual_vol: 0.19,
            annual_drift: 0.06, dividend_yield: 0.032, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        // ---- US names (EQ, NORTH_AMERICA, USD) ---------------------------------------------
        Instrument {
            isin: "US0378331005", wkn: "865985", symbol: "AAPL", name: "Apple Inc.",
            security_type: "EQ", asset_class: "EQUITY", sector: "INFORMATION_TECHNOLOGY",
            region: "NORTH_AMERICA", currency: "USD", base_price: 232.00, annual_vol: 0.25,
            annual_drift: 0.11, dividend_yield: 0.005, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "US5949181045", wkn: "870747", symbol: "MSFT", name: "Microsoft Corporation",
            security_type: "EQ", asset_class: "EQUITY", sector: "INFORMATION_TECHNOLOGY",
            region: "NORTH_AMERICA", currency: "USD", base_price: 465.00, annual_vol: 0.23,
            annual_drift: 0.12, dividend_yield: 0.007, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "US67066G1040", wkn: "918422", symbol: "NVDA", name: "NVIDIA Corporation",
            security_type: "EQ", asset_class: "EQUITY", sector: "INFORMATION_TECHNOLOGY",
            region: "NORTH_AMERICA", currency: "USD", base_price: 128.00, annual_vol: 0.48,
            annual_drift: 0.30, dividend_yield: 0.0003, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "US02079K3059", wkn: "A14Y6H", symbol: "GOOG", name: "Alphabet Inc. (Class C)",
            security_type: "EQ", asset_class: "EQUITY", sector: "COMMUNICATION_SERVICES",
            region: "NORTH_AMERICA", currency: "USD", base_price: 205.00, annual_vol: 0.27,
            annual_drift: 0.13, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "US0231351067", wkn: "906866", symbol: "AMZN", name: "Amazon.com Inc.",
            security_type: "EQ", asset_class: "EQUITY", sector: "CONSUMER_DISCRETIONARY",
            region: "NORTH_AMERICA", currency: "USD", base_price: 225.00, annual_vol: 0.29,
            annual_drift: 0.14, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "US88160R1014", wkn: "A1CX3T", symbol: "TSLA", name: "Tesla Inc.",
            security_type: "EQ", asset_class: "EQUITY", sector: "CONSUMER_DISCRETIONARY",
            region: "NORTH_AMERICA", currency: "USD", base_price: 265.00, annual_vol: 0.55,
            annual_drift: 0.10, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "US0846707026", wkn: "A0YJQ2", symbol: "BRK.B", name: "Berkshire Hathaway Inc. (Class B)",
            security_type: "EQ", asset_class: "EQUITY", sector: "FINANCIALS",
            region: "NORTH_AMERICA", currency: "USD", base_price: 465.00, annual_vol: 0.17,
            annual_drift: 0.09, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "US5324571083", wkn: "858560", symbol: "LLY", name: "Eli Lilly and Company",
            security_type: "EQ", asset_class: "EQUITY", sector: "HEALTH_CARE",
            region: "NORTH_AMERICA", currency: "USD", base_price: 850.00, annual_vol: 0.30,
            annual_drift: 0.20, dividend_yield: 0.007, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "US1912161007", wkn: "850663", symbol: "KO", name: "The Coca-Cola Company",
            security_type: "EQ", asset_class: "EQUITY", sector: "CONSUMER_STAPLES",
            region: "NORTH_AMERICA", currency: "USD", base_price: 71.00, annual_vol: 0.16,
            annual_drift: 0.06, dividend_yield: 0.029, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "US92826C8394", wkn: "A0NC7B", symbol: "V", name: "Visa Inc. (Class A)",
            security_type: "EQ", asset_class: "EQUITY", sector: "FINANCIALS",
            region: "NORTH_AMERICA", currency: "USD", base_price: 315.00, annual_vol: 0.21,
            annual_drift: 0.13, dividend_yield: 0.007, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        // ---- Europe (EQ, EUR) ---------------------------------------------------------------
        Instrument {
            isin: "NL0010273215", wkn: "A1J4U4", symbol: "ASML", name: "ASML Holding N.V.",
            security_type: "EQ", asset_class: "EQUITY", sector: "INFORMATION_TECHNOLOGY",
            region: "EUROPE", currency: "EUR", base_price: 720.00, annual_vol: 0.32,
            annual_drift: 0.15, dividend_yield: 0.010, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "FR0000121014", wkn: "853292", symbol: "MC", name: "LVMH Moet Hennessy Louis Vuitton SE",
            security_type: "EQ", asset_class: "EQUITY", sector: "CONSUMER_DISCRETIONARY",
            region: "EUROPE", currency: "EUR", base_price: 620.00, annual_vol: 0.26,
            annual_drift: 0.04, dividend_yield: 0.025, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "CH0038863350", wkn: "A0Q4DC", symbol: "NESN", name: "Nestle S.A.",
            security_type: "EQ", asset_class: "EQUITY", sector: "CONSUMER_STAPLES",
            region: "EUROPE", currency: "EUR", base_price: 82.00, annual_vol: 0.16,
            annual_drift: 0.02, dividend_yield: 0.034, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "DK0062498333", wkn: "A3EU6R", symbol: "NOVO-B", name: "Novo Nordisk A/S",
            security_type: "EQ", asset_class: "EQUITY", sector: "HEALTH_CARE",
            region: "EUROPE", currency: "EUR", base_price: 68.00, annual_vol: 0.30,
            annual_drift: 0.05, dividend_yield: 0.014, distributing: true, ter: 0.0,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        // ---- ETFs (DIVERSIFIED sector, EUR) --------------------------------------------------
        Instrument {
            isin: "IE00B4L5Y983", wkn: "A0RPWH", symbol: "EUNL", name: "iShares Core MSCI World UCITS ETF",
            security_type: "ETF", asset_class: "EQUITY", sector: "DIVERSIFIED",
            region: "GLOBAL", currency: "EUR", base_price: 104.00, annual_vol: 0.15,
            annual_drift: 0.07, dividend_yield: 0.0, distributing: false, ter: 0.002,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "IE00BK5BQT80", wkn: "A2PKXG", symbol: "VWCE", name: "Vanguard FTSE All-World UCITS ETF (Acc)",
            security_type: "ETF", asset_class: "EQUITY", sector: "DIVERSIFIED",
            region: "GLOBAL", currency: "EUR", base_price: 135.00, annual_vol: 0.15,
            annual_drift: 0.07, dividend_yield: 0.0, distributing: false, ter: 0.0022,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "IE00B3RBWM25", wkn: "A1JX52", symbol: "VWRL", name: "Vanguard FTSE All-World UCITS ETF (Dist)",
            security_type: "ETF", asset_class: "EQUITY", sector: "DIVERSIFIED",
            region: "GLOBAL", currency: "EUR", base_price: 128.00, annual_vol: 0.15,
            annual_drift: 0.07, dividend_yield: 0.017, distributing: true, ter: 0.0022,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "IE00B5BMR087", wkn: "A0YEDG", symbol: "SXR8", name: "iShares Core S&P 500 UCITS ETF",
            security_type: "ETF", asset_class: "EQUITY", sector: "DIVERSIFIED",
            region: "NORTH_AMERICA", currency: "EUR", base_price: 620.00, annual_vol: 0.16,
            annual_drift: 0.11, dividend_yield: 0.0, distributing: false, ter: 0.0007,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "IE00BTJRMP35", wkn: "A1XEY2", symbol: "XMME", name: "Xtrackers MSCI Emerging Markets UCITS ETF",
            security_type: "ETF", asset_class: "EQUITY", sector: "DIVERSIFIED",
            region: "EMERGING", currency: "EUR", base_price: 47.00, annual_vol: 0.19,
            annual_drift: 0.04, dividend_yield: 0.0, distributing: false, ter: 0.0018,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "IE0008471009", wkn: "593395", symbol: "EXW1", name: "iShares Core EURO STOXX 50 UCITS ETF",
            security_type: "ETF", asset_class: "EQUITY", sector: "DIVERSIFIED",
            region: "EUROPE", currency: "EUR", base_price: 47.00, annual_vol: 0.18,
            annual_drift: 0.05, dividend_yield: 0.025, distributing: true, ter: 0.0016,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "IE00B1XNHC34", wkn: "A0MW0M", symbol: "INRG", name: "iShares Global Clean Energy UCITS ETF",
            security_type: "ETF", asset_class: "EQUITY", sector: "DIVERSIFIED",
            region: "GLOBAL", currency: "EUR", base_price: 5.80, annual_vol: 0.35,
            annual_drift: -0.02, dividend_yield: 0.015, distributing: true, ter: 0.0065,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "IE00BDBRDM35", wkn: "A2AJEW", symbol: "AGGH", name: "iShares Core Global Aggregate Bond UCITS ETF",
            security_type: "ETF", asset_class: "BOND", sector: "DIVERSIFIED",
            region: "GLOBAL", currency: "EUR", base_price: 4.60, annual_vol: 0.06,
            annual_drift: 0.02, dividend_yield: 0.020, distributing: true, ter: 0.001,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "LU0290358497", wkn: "DBX1AR", symbol: "XEON", name: "Xtrackers II EUR Overnight Rate Swap UCITS ETF",
            security_type: "ETF", asset_class: "CASH", sector: "DIVERSIFIED",
            region: "EUROPE", currency: "EUR", base_price: 138.00, annual_vol: 0.001,
            annual_drift: 0.025, dividend_yield: 0.0, distributing: false, ter: 0.001,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "IE00B4ND3602", wkn: "A0N62G", symbol: "SGLD", name: "iShares Physical Gold ETC",
            security_type: "ETF", asset_class: "COMMODITY", sector: "DIVERSIFIED",
            region: "GLOBAL", currency: "EUR", base_price: 51.00, annual_vol: 0.14,
            annual_drift: 0.06, dividend_yield: 0.0, distributing: false, ter: 0.0012,
            venues: XETR_GETTEX, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        // ---- Crypto (24/7, DIVERSIFIED sector, EUR) ------------------------------------------
        Instrument {
            isin: "XF000BTC0017", wkn: "A27Z30", symbol: "BTC", name: "Bitcoin",
            security_type: "CRYPTO", asset_class: "CRYPTO", sector: "DIVERSIFIED",
            region: "GLOBAL", currency: "EUR", base_price: 58000.00, annual_vol: 0.55,
            annual_drift: 0.20, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: CRYPTO_VENUE, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "XF000ETH0019", wkn: "ETH017", symbol: "ETH", name: "Ethereum",
            security_type: "CRYPTO", asset_class: "CRYPTO", sector: "DIVERSIFIED",
            region: "GLOBAL", currency: "EUR", base_price: 3200.00, annual_vol: 0.65,
            annual_drift: 0.18, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: CRYPTO_VENUE, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        Instrument {
            isin: "XF000SOL0016", wkn: "SOL016", symbol: "SOL", name: "Solana",
            security_type: "CRYPTO", asset_class: "CRYPTO", sector: "DIVERSIFIED",
            region: "GLOBAL", currency: "EUR", base_price: 145.00, annual_vol: 0.85,
            annual_drift: 0.25, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: CRYPTO_VENUE, savings_plan_eligible: true, is_derivative: false, underlying_isin: None,
        },
        // ---- Derivatives (knockouts/warrants) ------------------------------------------------
        Instrument {
            isin: "DE000HS4AC31", wkn: "HS4AC3", symbol: "AAPL-KOL", name: "HSBC Knockout Long on Apple Inc.",
            security_type: "KNOCKOUT", asset_class: "EQUITY", sector: "INFORMATION_TECHNOLOGY",
            region: "NORTH_AMERICA", currency: "EUR", base_price: 2.45, annual_vol: 0.90,
            annual_drift: 0.30, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: GETTEX_ONLY, savings_plan_eligible: false, is_derivative: true,
            underlying_isin: Some("US0378331005"),
        },
        Instrument {
            isin: "DE000GS8NVC2", wkn: "GS8NVC", symbol: "NVDA-WTC", name: "Goldman Sachs Call Warrant on NVIDIA Corporation",
            security_type: "WARRANT", asset_class: "EQUITY", sector: "INFORMATION_TECHNOLOGY",
            region: "NORTH_AMERICA", currency: "EUR", base_price: 1.85, annual_vol: 1.10,
            annual_drift: 0.40, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: GETTEX_ONLY, savings_plan_eligible: false, is_derivative: true,
            underlying_isin: Some("US67066G1040"),
        },
        Instrument {
            isin: "DE000VT7SAP5", wkn: "VT7SAP", symbol: "SAP-WTP", name: "Vontobel Put Warrant on SAP SE",
            security_type: "WARRANT", asset_class: "EQUITY", sector: "INFORMATION_TECHNOLOGY",
            region: "GERMANY", currency: "EUR", base_price: 3.10, annual_vol: 0.75,
            annual_drift: -0.05, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: GETTEX_ONLY, savings_plan_eligible: false, is_derivative: true,
            underlying_isin: Some("DE0007164600"),
        },
        Instrument {
            isin: "DE000MS6NVS7", wkn: "MS6NVS", symbol: "NVDA-KOS", name: "Morgan Stanley Knockout Short on NVIDIA Corporation",
            security_type: "KNOCKOUT", asset_class: "EQUITY", sector: "INFORMATION_TECHNOLOGY",
            region: "NORTH_AMERICA", currency: "EUR", base_price: 1.20, annual_vol: 0.95,
            annual_drift: -0.25, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: GETTEX_ONLY, savings_plan_eligible: false, is_derivative: true,
            underlying_isin: Some("US67066G1040"),
        },
        Instrument {
            isin: "DE000BN2APL8", wkn: "BN2APL", symbol: "AAPL-WTC", name: "BNP Paribas Call Warrant on Apple Inc.",
            security_type: "WARRANT", asset_class: "EQUITY", sector: "INFORMATION_TECHNOLOGY",
            region: "NORTH_AMERICA", currency: "EUR", base_price: 4.20, annual_vol: 0.80,
            annual_drift: 0.25, dividend_yield: 0.0, distributing: false, ter: 0.0,
            venues: GETTEX_ONLY, savings_plan_eligible: false, is_derivative: true,
            underlying_isin: Some("US0378331005"),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn is_well_formed_isin(isin: &str) -> bool {
        let bytes = isin.as_bytes();
        if bytes.len() != 12 {
            return false;
        }
        let country_ok = bytes[0..2].iter().all(|b| b.is_ascii_uppercase());
        let body_ok = bytes[2..11].iter().all(|b| b.is_ascii_alphanumeric() && !b.is_ascii_lowercase());
        let check_digit_ok = bytes[11].is_ascii_digit();
        country_ok && body_ok && check_digit_ok
    }

    #[test]
    fn every_isin_is_well_formed() {
        for inst in catalog() {
            assert!(
                is_well_formed_isin(inst.isin),
                "ISIN '{}' ({}) is not a well-formed 2-letter+9-alnum+1-digit ISIN",
                inst.isin,
                inst.name
            );
        }
    }

    #[test]
    fn isins_are_unique() {
        let mut seen = HashSet::new();
        for inst in catalog() {
            assert!(seen.insert(inst.isin), "duplicate ISIN in catalog: {}", inst.isin);
        }
    }

    #[test]
    fn every_derivative_underlying_resolves_in_catalog() {
        for inst in catalog() {
            if inst.is_derivative {
                let underlying = inst
                    .underlying_isin
                    .unwrap_or_else(|| panic!("derivative '{}' has no underlying_isin", inst.isin));
                assert!(
                    find(underlying).is_some(),
                    "derivative '{}' references underlying '{}' which is not in the catalog",
                    inst.isin,
                    underlying
                );
            }
        }
    }

    #[test]
    fn catalog_size_is_in_expected_range() {
        let n = catalog().len();
        assert!((35..=45).contains(&n), "catalog has {n} instruments, expected 35-45");
    }

    #[test]
    fn find_is_case_insensitive_and_missing_isin_returns_none() {
        assert!(find("us0378331005").is_some());
        assert!(find("XX0000000000").is_none());
    }

    #[test]
    fn search_matches_by_name_isin_symbol_and_wkn() {
        assert!(search("apple").iter().any(|i| i.isin == "US0378331005"));
        assert!(search("US0378331005").iter().any(|i| i.symbol == "AAPL"));
        assert!(search("aapl").iter().any(|i| i.isin == "US0378331005"));
        assert!(search("716460").iter().any(|i| i.isin == "DE0007164600")); // SAP WKN
        assert!(search("").is_empty());
    }

    #[test]
    fn by_asset_class_covers_crypto() {
        let crypto = by_asset_class("CRYPTO");
        assert_eq!(crypto.len(), 3);
        assert!(crypto.iter().all(|i| i.security_type == "CRYPTO"));
    }

    #[test]
    fn derivatives_on_apple_found() {
        let derivs = derivatives_on("US0378331005");
        assert!(derivs.len() >= 2);
        assert!(derivs.iter().all(|i| i.is_derivative));
    }
}
