import { invoke } from "@tauri-apps/api/core";
import { recordCliCall } from "../lib/cliLog";
import type {
  WhoamiData,
  OvernightData,
  OvernightTransactionsData,
  BrokerOverviewData,
  BrokerAnalyticsData,
  BrokerCashBreakdownData,
  HoldingsData,
  TransactionsData,
  TransactionDetailData,
  QuoteData,
  ChartData,
  SecurityNewsData,
  WatchlistData,
  PriceAlertsData,
  SavingsPlansData,
  SavingsPlanConfigData,
  TradePreviewData,
  SavingsPlanPreviewData,
  TradeSubmitData,
  TradeCancelData,
  SearchData,
  DerivativesData,
  PortfolioGroupsData,
  CapabilitiesData,
  BrokerContextData,
  BrokerPortfolioListData,
  ChartTimeframe,
  NewsLocale,
  DerivativeType,
  DerivativeStrategy,
  DerivativeIssuer,
  DerivativeSubcategory,
  DerivativeSortField,
  SortOrder,
  SavingsPlanFrequency,
  SavingsPlanPaymentMethod,
  OrderType,
  TradeSide,
} from "./types";

// The Rust side already unwraps the sc MachineEnvelope: commands resolve
// with the envelope's `data` and reject with a message string (hints
// included) when the CLI reports an error.
//
// Every call is also recorded in the in-memory CLI log so the UI can show
// which `sc` invocation produced the data on screen — the CLI is the product,
// and the app should never look like a parallel implementation of it.
async function invokeSc<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const started = Date.now();
  try {
    const result = await invoke<T>(command, args);
    recordCliCall({ command, args, startedAt: started, ok: true });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    recordCliCall({
      command,
      args,
      startedAt: started,
      ok: false,
      error: error.message,
    });
    throw error;
  }
}

/** Shared read options accepted by the quote-backed list commands. */
export interface QuoteReadOptions {
  portfolioId?: string;
  includeYearToDate?: boolean;
  quoteSource?: string;
}

export const api = {
  // ---------------------------------------------------------------- session
  /**
   * `sc login` — interactive device-code flow. `localReadOnly` maps to
   * `--local-read-only`, which stores the session in a locally enforced
   * read-only mode: reads keep working, writes are blocked by the CLI until
   * the user logs in again without it. It does not change token permissions
   * or backend access.
   */
  login: (localReadOnly = false) => invokeSc<void>("login", { localReadOnly }),
  logout: () => invokeSc<void>("logout"),
  getWhoami: () => invokeSc<WhoamiData>("get_whoami"),
  getCapabilities: () => invokeSc<CapabilitiesData>("get_capabilities"),

  // ---------------------------------------------------------------- context
  getBrokerContext: () => invokeSc<BrokerContextData>("get_broker_context"),
  listBrokerPortfolios: () =>
    invokeSc<BrokerPortfolioListData>("list_broker_portfolios"),
  selectBrokerContext: (portfolioId: string) =>
    invokeSc<void>("select_broker_context", { portfolioId }),

  // -------------------------------------------------------------- overnight
  getOvernight: (savingsAccountId?: string) =>
    invokeSc<OvernightData>("get_overnight", { savingsAccountId }),
  getOvernightTransactions: (params: {
    savingsAccountId?: string;
    pageSize?: number;
    cursor?: string;
    typeFilter?: string[];
    searchTerm?: string;
    fromTime?: string;
    toTime?: string;
  }) => invokeSc<OvernightTransactionsData>("get_overnight_transactions", params),

  // ------------------------------------------------------------------ reads
  getBrokerOverview: (portfolioId?: string, includeYearToDate = false) =>
    invokeSc<BrokerOverviewData>("get_broker_overview", {
      portfolioId,
      includeYearToDate,
    }),
  getBrokerAnalytics: (portfolioId?: string) =>
    invokeSc<BrokerAnalyticsData>("get_broker_analytics", { portfolioId }),
  getBrokerCashBreakdown: (portfolioId?: string) =>
    invokeSc<BrokerCashBreakdownData>("get_broker_cash_breakdown", {
      portfolioId,
    }),
  getHoldings: (opts: QuoteReadOptions = {}) =>
    invokeSc<HoldingsData>("get_holdings", {
      portfolioId: opts.portfolioId,
      includeYearToDate: opts.includeYearToDate ?? false,
      quoteSource: opts.quoteSource,
    }),

  getTransactions: (params: {
    portfolioId?: string;
    pageSize?: number;
    cursor?: string;
    typeFilter?: string[];
    status?: string[];
    searchTerm?: string;
    isin?: string;
    fromTime?: string;
    toTime?: string;
    includeReinvestmentSubtypes?: boolean;
  }) => invokeSc<TransactionsData>("get_transactions", params),
  getTransactionDetail: (transactionId: string, portfolioId?: string) =>
    invokeSc<TransactionDetailData>("get_transaction_detail", {
      transactionId,
      portfolioId,
    }),

  // ------------------------------------------------------------ market data
  getQuote: (isin: string, opts: QuoteReadOptions = {}) =>
    invokeSc<QuoteData>("get_quote", {
      isin,
      portfolioId: opts.portfolioId,
      includeYearToDate: opts.includeYearToDate ?? false,
      quoteSource: opts.quoteSource,
    }),
  getChart: (isin: string, timeframe: ChartTimeframe) =>
    invokeSc<ChartData>("get_chart", { isin, timeframe }),
  getSecurityNews: (isin: string, locale?: NewsLocale) =>
    invokeSc<SecurityNewsData>("get_security_news", { isin, locale }),
  search: (query: string, opts: QuoteReadOptions = {}) =>
    invokeSc<SearchData>("search_securities", {
      query,
      portfolioId: opts.portfolioId,
      includeYearToDate: opts.includeYearToDate ?? false,
      quoteSource: opts.quoteSource,
    }),

  /** Every filter `sc broker derivatives search` accepts. */
  getDerivatives: (params: {
    underlying: string;
    derivativeType: DerivativeType;
    strategy: DerivativeStrategy;
    limit?: number;
    offset?: number;
    issuer?: DerivativeIssuer[];
    productSubcategory?: DerivativeSubcategory[];
    leverageMin?: string;
    leverageMax?: string;
    knockoutBarrierMin?: string;
    knockoutBarrierMax?: string;
    strikeMin?: string;
    strikeMax?: string;
    omegaMin?: string;
    omegaMax?: string;
    deltaMin?: string;
    deltaMax?: string;
    factorMin?: string;
    factorMax?: string;
    expiryFrom?: string;
    expiryTo?: string;
    sortField?: DerivativeSortField;
    sortOrder?: SortOrder;
    portfolioId?: string;
  }) => invokeSc<DerivativesData>("search_derivatives", params),

  // -------------------------------------------------------------- watchlist
  getWatchlist: (opts: QuoteReadOptions = {}) =>
    invokeSc<WatchlistData>("get_watchlist", {
      portfolioId: opts.portfolioId,
      includeYearToDate: opts.includeYearToDate ?? false,
      quoteSource: opts.quoteSource,
    }),
  addToWatchlist: (isin: string, portfolioId?: string) =>
    invokeSc<void>("add_to_watchlist", { isin, portfolioId }),
  removeFromWatchlist: (isin: string, portfolioId?: string) =>
    invokeSc<void>("remove_from_watchlist", { isin, portfolioId }),

  // ----------------------------------------------------------- price alerts
  getPriceAlerts: (portfolioId?: string, activeOnly = false) =>
    invokeSc<PriceAlertsData>("get_price_alerts", { portfolioId, activeOnly }),
  addPriceAlert: (params: {
    isin?: string;
    ticker?: string;
    price: string;
    portfolioId?: string;
  }) => invokeSc<void>("add_price_alert", params),
  removePriceAlert: (alertId: string, portfolioId?: string) =>
    invokeSc<void>("remove_price_alert", { alertId, portfolioId }),

  // ---------------------------------------------------------- savings plans
  getSavingsPlans: (portfolioId?: string) =>
    invokeSc<SavingsPlansData>("get_savings_plans", { portfolioId }),
  getSavingsPlanConfig: (isin: string, portfolioId?: string) =>
    invokeSc<SavingsPlanConfigData>("get_savings_plan_config", {
      isin,
      portfolioId,
    }),
  /**
   * Two-phase. Called without `confirm` this only previews and returns the
   * full ex-ante cost disclosure plus a short-lived confirmation id; the UI
   * must present that disclosure and take a separate affirmative confirmation
   * before calling again with the same arguments plus `confirm`.
   */
  addSavingsPlan: (params: {
    isin: string;
    amount: string;
    frequency?: SavingsPlanFrequency;
    dayOfMonth?: number;
    yearMonth?: string;
    dynamizationRate?: string;
    paymentMethod?: SavingsPlanPaymentMethod;
    appropriatenessId?: string;
    acknowledgedAppropriatenessWarningVersion?: string;
    portfolioId?: string;
    confirm?: string;
  }) => invokeSc<SavingsPlanPreviewData>("add_savings_plan", params),
  removeSavingsPlan: (isin: string, portfolioId?: string) =>
    invokeSc<void>("remove_savings_plan", { isin, portfolioId }),

  // ----------------------------------------------------------------- trading
  /**
   * Phase 1: preview only. Never places an order.
   *
   * Deliberately takes NO `portfolioId`: `sc broker trade buy|sell` has no
   * `--portfolio-id` flag and rejects it, so trading always targets the
   * persisted broker context. Keeping it out of the type stops a caller from
   * aiming a money-moving command at another portfolio by accident.
   */
  tradePreview: (params: {
    side: TradeSide;
    isin: string;
    amount?: string;
    shares?: string;
    orderType?: OrderType;
    limitPrice?: string;
    stopPrice?: string;
    venue?: string;
  }) => invokeSc<TradePreviewData>("trade_preview", params),
  /** Phase 2: submits, and only after a separate explicit user confirmation. */
  tradeSubmit: (params: {
    side: TradeSide;
    confirmationId: string;
    isin?: string;
    amount?: string;
    shares?: string;
    orderType?: OrderType;
    limitPrice?: string;
    stopPrice?: string;
    venue?: string;
    /** Buy-only: the CLI rejects `--accept-unsuitable` on a sell. */
    acceptUnsuitable?: boolean;
  }) => invokeSc<TradeSubmitData>("trade_submit", params),
  tradeCancel: (orderId: string, portfolioId?: string) =>
    invokeSc<TradeCancelData>("trade_cancel", { orderId, portfolioId }),

  // -------------------------------------------------------- portfolio groups
  getPortfolioGroups: (portfolioId?: string, groupId?: string) =>
    invokeSc<PortfolioGroupsData>("get_portfolio_groups", {
      portfolioId,
      groupId,
    }),
  createPortfolioGroup: (params: {
    name: string;
    description?: string;
    portfolioId?: string;
  }) => invokeSc<void>("create_portfolio_group", params),
  updatePortfolioGroup: (params: {
    groupId: string;
    name?: string;
    description?: string;
    clearDescription?: boolean;
    portfolioId?: string;
  }) => invokeSc<void>("update_portfolio_group", params),
  deletePortfolioGroup: (groupId: string, portfolioId?: string) =>
    invokeSc<void>("delete_portfolio_group", { groupId, portfolioId }),
  assignToGroup: (params: {
    groupId: string;
    isin: string[];
    portfolioId?: string;
  }) => invokeSc<void>("assign_to_group", params),
  unassignFromGroup: (params: {
    groupId: string;
    isin: string[];
    portfolioId?: string;
  }) => invokeSc<void>("unassign_from_group", params),
};
