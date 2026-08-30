import { invoke } from "@tauri-apps/api/core";
import type {
  MachineEnvelope,
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
  TradeSubmitData,
  TradeCancelData,
  SearchData,
  DerivativesData,
  PortfolioGroupsData,
  CapabilitiesData,
} from "./types";

async function invokeSc<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await invoke<MachineEnvelope<T>>(command, args);
  if (!result.ok) {
    const msg = result.error?.message || "Unknown error";
    const hints = result.hints?.length ? `\nHints: ${result.hints.join(", ")}` : "";
    throw new Error(`${msg}${hints}`);
  }
  return result.data as T;
}

export const api = {
  login: () => invokeSc<void>("login"),
  logout: () => invokeSc<void>("logout"),
  getWhoami: () => invokeSc<WhoamiData>("get_whoami"),
  getCapabilities: () => invokeSc<CapabilitiesData>("get_capabilities"),

  getOvernight: (savingsAccountId?: string) =>
    invokeSc<OvernightData>("get_overnight", { savingsAccountId }),
  getOvernightTransactions: (params: {
    savingsAccountId?: string;
    pageSize?: number;
    cursor?: string;
    typeFilter?: string[];
    searchTerm?: string;
  }) => invokeSc<OvernightTransactionsData>("get_overnight_transactions", params),

  getBrokerOverview: (portfolioId?: string) =>
    invokeSc<BrokerOverviewData>("get_broker_overview", { portfolioId }),
  getBrokerAnalytics: (portfolioId?: string) =>
    invokeSc<BrokerAnalyticsData>("get_broker_analytics", { portfolioId }),
  getBrokerCashBreakdown: (portfolioId?: string) =>
    invokeSc<BrokerCashBreakdownData>("get_broker_cash_breakdown", { portfolioId }),
  getHoldings: (portfolioId?: string) =>
    invokeSc<HoldingsData>("get_holdings", { portfolioId }),

  getTransactions: (params: {
    portfolioId?: string;
    pageSize?: number;
    cursor?: string;
    typeFilter?: string[];
    status?: string[];
    searchTerm?: string;
    isin?: string;
  }) => invokeSc<TransactionsData>("get_transactions", params),
  getTransactionDetail: (transactionId: string, portfolioId?: string) =>
    invokeSc<TransactionDetailData>("get_transaction_detail", { transactionId, portfolioId }),

  getQuote: (isin: string, portfolioId?: string) =>
    invokeSc<QuoteData>("get_quote", { isin, portfolioId }),
  getChart: (isin: string, timeframe: string) =>
    invokeSc<ChartData>("get_chart", { isin, timeframe }),
  getSecurityNews: (isin: string, locale?: string) =>
    invokeSc<SecurityNewsData>("get_security_news", { isin, locale }),

  getWatchlist: (portfolioId?: string) =>
    invokeSc<WatchlistData>("get_watchlist", { portfolioId }),
  addToWatchlist: (isin: string, portfolioId?: string) =>
    invokeSc<void>("add_to_watchlist", { isin, portfolioId }),
  removeFromWatchlist: (isin: string, portfolioId?: string) =>
    invokeSc<void>("remove_from_watchlist", { isin, portfolioId }),

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

  getSavingsPlans: (portfolioId?: string) =>
    invokeSc<SavingsPlansData>("get_savings_plans", { portfolioId }),
  getSavingsPlanConfig: (isin: string, portfolioId?: string) =>
    invokeSc<SavingsPlanConfigData>("get_savings_plan_config", { isin, portfolioId }),
  addSavingsPlan: (params: {
    isin: string;
    amount: string;
    frequency?: string;
    portfolioId?: string;
    confirm?: string;
  }) => invokeSc<TradePreviewData>("add_savings_plan", params),
  removeSavingsPlan: (isin: string, portfolioId?: string) =>
    invokeSc<void>("remove_savings_plan", { isin, portfolioId }),

  search: (query: string, portfolioId?: string) =>
    invokeSc<SearchData>("search_securities", { query, portfolioId }),

  tradePreview: (params: {
    side: "buy" | "sell";
    isin: string;
    amount?: string;
    shares?: string;
    orderType?: string;
    limitPrice?: string;
    stopPrice?: string;
    venue?: string;
    portfolioId?: string;
  }) => invokeSc<TradePreviewData>("trade_preview", params),
  tradeSubmit: (params: {
    side: "buy" | "sell";
    confirmationId: string;
    isin?: string;
    amount?: string;
    shares?: string;
    orderType?: string;
    limitPrice?: string;
    stopPrice?: string;
    venue?: string;
    portfolioId?: string;
    acceptUnsuitable?: boolean;
  }) => invokeSc<TradeSubmitData>("trade_submit", params),
  tradeCancel: (orderId: string, portfolioId?: string) =>
    invokeSc<TradeCancelData>("trade_cancel", { orderId, portfolioId }),

  getDerivatives: (params: {
    underlying: string;
    type: string;
    strategy: string;
    limit?: number;
    offset?: number;
    issuer?: string[];
    leverageMin?: string;
    leverageMax?: string;
    sortField?: string;
    sortOrder?: string;
    portfolioId?: string;
  }) => invokeSc<DerivativesData>("search_derivatives", params),

  getPortfolioGroups: (portfolioId?: string, groupId?: string) =>
    invokeSc<PortfolioGroupsData>("get_portfolio_groups", { portfolioId, groupId }),
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
