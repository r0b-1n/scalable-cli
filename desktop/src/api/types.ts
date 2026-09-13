/**
 * Types for the `sc --json` payloads.
 *
 * These mirror the `data` member of the CLI's machine envelope (the Rust IPC
 * layer already unwraps `{ok, command, data, error, hints}` and rejects on
 * error). Field names below were taken from real `sc <command> --json` output,
 * so they are snake_case except where the CLI passes a GraphQL field through
 * verbatim — `performance[].simpleAbsoluteReturn` and the `ex_ante_costs`
 * subtree keep their camelCase spelling on purpose.
 *
 * Payloads are intentionally typed loosely where the CLI forwards raw backend
 * data: extra keys are common and must never break rendering.
 */

// ------------------------------------------------------------------ literals

export type TradeSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";
export type ChartTimeframe = "1d" | "7d" | "1m" | "3m" | "6m" | "ytd" | "1y" | "max";
export type NewsLocale = "de_DE" | "en_DE";
export type SortOrder = "asc" | "desc";

export type SavingsPlanFrequency =
  | "monthly"
  | "bi-monthly"
  | "quarterly"
  | "semi-annually"
  | "annually";

export type SavingsPlanPaymentMethod =
  | "reference-account"
  | "buying-power-with-reference-account-fallback";

export type DerivativeType = "knockout" | "warrant" | "factor";
export type DerivativeStrategy = "long" | "short" | "put" | "call";
export type DerivativeIssuer =
  | "goldman-sachs"
  | "hsbc"
  | "hvb"
  | "bnp"
  | "vontobel"
  | "morgan-stanley"
  | "soc-gen";
export type DerivativeSubcategory = "mini-future" | "turbo";
export type DerivativeSortField =
  | "strike"
  | "leverage"
  | "expiry-date"
  | "knockout-barrier"
  | "distance-to-knockout"
  | "premium-absolute"
  | "premium-relative"
  | "distance-to-strike"
  | "omega"
  | "delta"
  | "implied-volatility"
  | "factor";

/** `sc broker transactions --type-filter` (normalised, case-insensitive). */
export const TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "SAVINGS_PLAN",
  "DEPOSIT",
  "WITHDRAWAL",
  "DISTRIBUTION",
  "FEE",
  "INTEREST",
  "TAX",
  "TAX_RETURN",
  "SWAP_IN",
  "SWAP_OUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "CURRENCY_SWITCH_BUY",
  "CURRENCY_SWITCH_SELL",
  "CASH_TRANSFER_IN",
  "CASH_TRANSFER_OUT",
  "POCKET_MONEY",
  "REINVESTMENT",
  "REINVESTMENT_DISTRIBUTION",
  "REINVESTMENT_POCKET_MONEY",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** `sc broker transactions --status`. */
export const TRANSACTION_STATUSES = [
  "CREATED",
  "REQUESTED",
  "PENDING",
  "PARTIAL_FILLED",
  "FILLED",
  "SETTLED",
  "CANCELLED",
  "CANCEL_REQUESTED",
  "EXPIRED",
  "REJECTED",
  "CONFIRMED",
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/** Statuses that mean "this order is still working and can be cancelled". */
export const OPEN_ORDER_STATUSES: readonly TransactionStatus[] = [
  "CREATED",
  "REQUESTED",
  "PENDING",
  "PARTIAL_FILLED",
  "CANCEL_REQUESTED",
];

// ------------------------------------------------------------------ envelope

/**
 * Portfolio-scoped reads share this wrapper: the resolved ids, how they were
 * resolved, and the payload under `result`.
 */
export interface BrokerEnvelope<T> {
  account_id: string;
  portfolio_id: string;
  resolution: { account: string; portfolio: string };
  result: T;
}

// ------------------------------------------------------------------- session

export interface WhoamiData {
  result: {
    personOverview: {
      id: string;
      externalId?: string | null;
      locale?: string | null;
      personalDetails?: { firstName?: string | null; lastName?: string | null } | null;
    };
  };
}

export interface CapabilitiesData {
  version: string;
  output: string;
  auth: { modes: string[]; non_interactive_modes: string[] };
  commands: string[];
  command_metadata: Record<string, { human_only?: boolean; json_supported?: boolean }>;
  workflows: Record<string, unknown>;
  local_trade_controls?: Record<string, unknown>;
  exit_codes: Record<string, number>;
}

export interface BrokerContextData {
  context_file: string;
  context: { account_id: string; portfolio_id: string | null } | null;
}

export interface BrokerPortfolioListData {
  account_id: string;
  portfolios: string[];
  selected_portfolio_id: string | null;
}

// ------------------------------------------------------------------ overview

export interface PerformanceEntry {
  timeframe: string;
  /** Absolute return in account currency. The CLI does not report a relative %. */
  simpleAbsoluteReturn: number;
}

export type BrokerOverviewData = BrokerEnvelope<{
  account_id: string;
  portfolio_id: string;
  valuation: { total: number; securities: number; crypto: number };
  performance: PerformanceEntry[];
  timestamps: {
    valuation_timestamp_utc: string | null;
    inventory_timestamp_utc: string | null;
  };
}>;

/** One row within an allocation dimension. */
export interface AllocationPosition {
  id?: string | null;
  name?: string | null;
  /** Value in the account currency. */
  valuation?: number | null;
  /** Share of the portfolio as a 0..1 fraction, not a percentage. */
  weight?: number | null;
  contributors?: Record<string, unknown>[];
  subpositions?: Record<string, unknown>[];
  [key: string]: unknown;
}

/**
 * One allocation dimension. The rows live in `positions`; the entry itself
 * only carries the dimension `type`.
 */
export interface AllocationEntry {
  /** Allocation dimension, e.g. ASSET_CLASS / SECTOR / REGION / CURRENCY. */
  type?: string | null;
  id?: string | null;
  positions?: AllocationPosition[];
  [key: string]: unknown;
}

export type BrokerAnalyticsData = BrokerEnvelope<{
  account_id: string;
  portfolio_id: string;
  analysis_type: string;
  portfolio_coverage: number;
  result_id?: string | null;
  last_updated_utc?: string | null;
  allocations: AllocationEntry[];
  health_checks: Record<string, unknown>[];
  scenarios: Record<string, unknown>[];
  invalid_securities: Record<string, unknown>[];
  invalid_securities_count: number;
  equity_company_styles?: Record<string, unknown> | null;
  fixed_income_ratings?: Record<string, unknown> | null;
  payments?: Record<string, unknown> | null;
  trial_period?: Record<string, unknown> | null;
}>;

/** Cash figures arrive as decimal strings to avoid float drift. */
export type BrokerCashBreakdownData = BrokerEnvelope<{
  account_id: string;
  portfolio_id: string;
  cash_balance: string;
  buying_power: string;
  buying_power_without_credit: string;
  available_credit_line: string;
  derivatives_buying_power: string;
  available_for_derivatives: string;
  loaned: string;
  pending_buy_orders_amount: string;
  possible_taxes: string;
}>;

// ------------------------------------------------------------------ holdings

export interface Holding {
  isin: string;
  name: string;
  security_type: string;
  quantity: number;
  blocked_quantity: number;
  pending_quantity: number;
  fifo_price: number;
  valuation: number;
  valuation_currency: string;
  quote_mid_price: number;
  quote_currency: string;
  quote_is_outdated: boolean;
  quote_timestamp_utc: string | null;
  /** Present only with `--include-year-to-date`. */
  year_to_date_performance?: number | null;
}

export type HoldingsData = BrokerEnvelope<{
  account_id: string;
  portfolio_id: string;
  count: number;
  items: Holding[];
}>;

// -------------------------------------------------------------- transactions

export interface Transaction {
  id: string;
  type: string;
  status: string;
  currency: string;
  description: string;
  last_event_datetime: string;
  is_cancellation: boolean;
  custodian?: string | null;
  documents?: unknown[];
  isin?: string | null;
  quantity?: number | null;
  amount?: number | null;
  side?: string | null;
  limit_price?: number | null;
  stop_price?: number | null;
  security_transaction_type?: string | null;
  cash_transaction_type?: string | null;
  related_isin?: string | null;
  summary_type?: string | null;
  unknown_summary_type?: boolean;
}

/** Echo of the filters the CLI actually applied, plus its fingerprint. */
export interface TransactionQueryInput {
  pageSize?: number | null;
  cursor?: string | null;
  type?: string[] | null;
  status?: string[] | null;
  searchTerm?: string | null;
  isin?: string | null;
  fromTime?: string | null;
  toTime?: string | null;
  includeReinvestmentSubtypes?: boolean | null;
}

export type TransactionsData = BrokerEnvelope<{
  account_id: string;
  portfolio_id: string;
  count: number;
  total: number;
  cursor: string | null;
  input: TransactionQueryInput;
  input_fingerprint: string;
  items: Transaction[];
}>;

export type TransactionDetailData = BrokerEnvelope<{
  [key: string]: unknown;
}>;

// ------------------------------------------------------------- market data

export interface SecuritySummary {
  isin: string;
  name: string;
  security_type: string;
  quote_mid_price: number;
  quote_currency: string;
  quote_is_outdated: boolean;
  quote_timestamp_utc: string | null;
}

export type SearchData = BrokerEnvelope<{
  account_id: string;
  portfolio_id: string;
  query: string;
  count: number;
  items: SecuritySummary[];
}>;

export type WatchlistData = BrokerEnvelope<{
  account_id: string;
  portfolio_id: string;
  count: number;
  items: SecuritySummary[];
}>;

/** Performance of a quote over one named window, e.g. `ONE_DAY`. */
export interface QuotePerformance {
  timeframe: string;
  performance: number;
  simple_absolute_return: number;
}

/** The unwrapped payload of `sc broker quote` — what callers hold after `.result`. */
export interface Quote {
  account_id: string;
  portfolio_id: string;
  security_id: string;
  isin: string;
  name: string;
  security_type: string;
  quote_tick_id: string;
  quote_mid_price: number;
  quote_bid_price: number;
  quote_ask_price: number;
  quote_currency: string;
  quote_is_outdated: boolean;
  quote_timestamp_utc: string | null;
  quote_performance_date: string | null;
  quote_performances: QuotePerformance[];
}

export type QuoteData = BrokerEnvelope<Quote>;

export interface ChartPoint {
  mid_price: number;
  timestamp_utc: string;
}

/** `sc broker chart` is not portfolio-scoped: no BrokerEnvelope wrapper. */
export interface ChartData {
  isin: string;
  timeframe: string;
  currency: string;
  source: string;
  point_count: number;
  closing_reference_point: ChartPoint | null;
  data_points: ChartPoint[];
}

export interface NewsSource {
  id: string;
  headline: string;
  source_name: string;
  publication_time_utc: string;
}

export interface SecurityNewsData {
  isin: string;
  locale: string;
  summary: { short: string | null; long: string | null; last_updated: string | null };
  sources: NewsSource[];
}

// ----------------------------------------------------------- price alerts

export interface PriceAlert {
  alert_id: string;
  name: string;
  price: string;
  direction: string;
  is_active: boolean;
  security_type: string;
  /** Null for crypto alerts, which are keyed by ticker instead. */
  isin: string | null;
  ticker?: string | null;
  can_add_new_for_instrument: boolean;
  triggered_timestamp_utc: string | null;
}

export type PriceAlertsData = BrokerEnvelope<{
  account_id: string;
  portfolio_id: string;
  active_only: boolean;
  count: number;
  items: PriceAlert[];
}>;

// ---------------------------------------------------------- savings plans

export interface SavingsPlan {
  isin: string;
  name: string;
  security_type: string;
  kind: string;
  amount: string;
  frequency: string;
  day_of_month: number;
  dynamization_rate: string;
  payment_method: string;
  next_execution_date: string;
  next_execution_epoch_day?: number;
}

export type SavingsPlansData = BrokerEnvelope<{
  account_id: string;
  portfolio_id: string;
  count: number;
  crypto_count: number;
  non_crypto_count: number;
  total_savings_plan_amount: string;
  items: SavingsPlan[];
}>;

export type SavingsPlanConfigData = BrokerEnvelope<{
  security: { isin: string; name: string; security_type: string };
  amount_limits: { min: string; max: string };
  frequencies: string[];
  payment_methods: string[];
  dynamization_rates: string[];
  defaults: {
    frequency: string;
    day_of_month: number;
    year_month: string;
    dynamization_rate: string;
    payment_method: string;
  };
  schedules: {
    day_of_month: number;
    is_default: boolean;
    is_earliest: boolean;
    available_year_months: string[];
  }[];
}>;

// ------------------------------------------------------- portfolio groups

export interface PortfolioGroupItem {
  isin: string;
  name: string;
  security_type: string;
}

export interface PortfolioGroup {
  group_id: string;
  name: string;
  description: string | null;
  items: PortfolioGroupItem[];
  number_of_pending_orders: number;
  savings_plans_amount: string;
  performance: {
    currency: string;
    valuation: string;
    since_buy: { performance: string; simple_absolute_return: string };
  };
}

export type PortfolioGroupsData = BrokerEnvelope<{
  portfolio_groups: PortfolioGroup[];
  ungrouped_items: PortfolioGroupItem[];
  max_groups_per_portfolio_reached: boolean;
  offer_allows_additional_group: boolean;
}>;

// ------------------------------------------------------------- derivatives

export interface DerivativeValue {
  value: number;
  currency_iso_code?: string | null;
  kind?: string | null;
}

export interface Derivative {
  isin: string;
  underlying_isin: string;
  issuer: string;
  strategy: string;
  product_subcategory: string | null;
  leverage: number | null;
  strike: DerivativeValue | null;
  knockout_barrier: DerivativeValue | null;
  premium_absolute: DerivativeValue | null;
  premium_percentage: number | null;
  distance_to_knockout: number | null;
  distance_to_strike: number | null;
  omega: number | null;
  delta: number | null;
  factor: number | null;
  implied_volatility: number | null;
  expiry_date: { date: string; epoch_day?: number } | null;
  expiry_is_open_end: boolean;
}

export type DerivativesData = BrokerEnvelope<{
  account_id: string;
  portfolio_id: string;
  underlying_isin: string;
  derivative_type: string;
  count: number;
  total_available: number;
  limit: number;
  offset: number;
  items: Derivative[];
}>;

// --------------------------------------------------------------- overnight

export interface OvernightAccount {
  display_name: string;
  owner_kind: string;
  is_active: boolean;
}

export interface OvernightData {
  savings_account_id: string;
  account: OvernightAccount;
  selection: { account: string };
  result: {
    interest_rate: string;
    balance: string;
    current_interest_bearing_amount: string;
    current_accrued_amount: string;
    estimated_next_payout_amount: string;
    next_payout_date: string | null;
    deposit_accrued_lifetime_amount: string;
  };
}

export interface OvernightTransaction {
  id: string;
  type: string;
  status: string;
  currency: string;
  amount: string;
  description: string;
  last_event_datetime: string;
  is_cancellation: boolean;
  custodian?: string | null;
  cash_transaction_type?: string | null;
  related_isin?: string | null;
  documents?: unknown[];
}

export interface OvernightTransactionsData {
  savings_account_id: string;
  account: OvernightAccount;
  selection: { account: string };
  result: {
    count: number;
    total: number;
    cursor: string | null;
    input: Record<string, unknown>;
    input_fingerprint: string;
    items: OvernightTransaction[];
  };
}

// ------------------------------------------------------------------ trading

/** One labelled field of the mandated phase-1 disclosure. */
export interface PresentationField {
  label: string;
  path: string;
  value: unknown;
  value_type: string;
}

export interface PresentationSection {
  title: string;
  fields: PresentationField[];
}

/**
 * Phase-1 output. `presentation.sections` is the disclosure the UI MUST render
 * in full, in `section_order`, before offering phase 2; `compliance` states the
 * rule that requires it.
 */
export interface TradePreviewData {
  account_id: string;
  portfolio_id: string;
  resolution?: { account: string; portfolio: string };
  next_step: string;
  compliance: {
    rule_id: string;
    instruction: string;
    must_present_all_information: boolean;
    requires_explicit_user_confirmation_between_phases: boolean;
    confirmation_must_be_separate_step: boolean;
    forbid_automatic_phase_2_execution: boolean;
    phase_2_requirement: string;
    required_json_paths: string[];
    presentation: {
      format: string;
      section_order: string[];
      required_leaf_paths: string[];
      display_null_as_literal?: boolean;
      preserve_exact_values?: boolean;
      raw_json_only_on_user_request?: boolean;
    };
  };
  confirmation: {
    id: string;
    command_template: string;
    phase_1_command_template_json?: string;
    phase_2_command_template_json?: string;
    expires_at_epoch: number;
    intent_checksum: string;
    requires_accept_unsuitable: boolean;
    accept_unsuitable_flag: string | null;
    warning_version: string | null;
    required_fields: Record<string, string | null>;
  };
  presentation: {
    format: string;
    section_order: string[];
    required_leaf_paths: string[];
    sections: Record<string, PresentationSection>;
  };
  result: Record<string, unknown>;
}

/** Phase-2 output shares phase 1's shape; `result.order_submission` differs. */
export type TradeSubmitData = TradePreviewData & {
  result: { order_submission?: { submitted: boolean; reason?: string | null } } & Record<
    string,
    unknown
  >;
};

export type TradeCancelData = Record<string, unknown>;

/**
 * Savings-plan phase 1/2.
 *
 * NOTE the shape difference from trading, verified against real CLI output:
 * a trade preview puts `confirmation`/`presentation`/`compliance` at the TOP
 * level of `data`, while a savings-plan preview nests them inside `result`
 * alongside `security`, `effective_configuration` and `ex_ante_costs`.
 * Reading `data.confirmation.id` here returns undefined.
 */
export type SavingsPlanPreviewData = BrokerEnvelope<{
  action: string;
  next_step: string;
  security: { isin: string; name: string; security_type: string };
  input: Record<string, unknown>;
  effective_configuration: Record<string, unknown>;
  cost_venue?: string | null;
  ex_ante_costs: Record<string, unknown>;
  compliance: TradePreviewData["compliance"];
  confirmation: TradePreviewData["confirmation"];
  presentation: TradePreviewData["presentation"];
}>;
