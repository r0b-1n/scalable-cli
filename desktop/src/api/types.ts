export interface MachineEnvelope<T = unknown> {
  ok: boolean;
  command: string;
  data?: T;
  error?: { code: string; message: string };
  hints?: string[];
}

export interface WhoamiData {
  result: {
    personOverview: {
      id: string;
      locale?: string | null;
      personalDetails?: {
        firstName?: string | null;
        lastName?: string | null;
      } | null;
    };
  };
}

export interface OvernightData {
  savingsAccountId?: string;
  iban?: string;
  balance?: string;
  interestRate?: string;
  currency?: string;
}

export interface OvernightTransactionsData {
  transactions: OvernightTransaction[];
  nextCursor?: string;
}

export interface OvernightTransaction {
  id: string;
  type: string;
  amount: string;
  currency: string;
  date: string;
  description?: string;
}

export interface BrokerOverviewData {
  portfolioId?: string;
  totalValue?: string;
  buyValue?: string;
  simpleAbsoluteReturn?: Record<string, string>;
  dayChange?: string;
  dayChangePercent?: string;
}

export interface BrokerAnalyticsData {
  allocations?: AllocationEntry[];
}

export interface AllocationEntry {
  name: string;
  percentage: number;
  value?: string;
}

export interface BrokerCashBreakdownData {
  cashBalance?: string;
  buyingPower?: string;
  creditLine?: string;
  currency?: string;
}

export interface HoldingsData {
  holdings: Holding[];
}

export interface Holding {
  isin: string;
  name?: string;
  quantity?: string;
  currentPrice?: string;
  currentValue?: string;
  totalReturn?: string;
  totalReturnPercent?: string;
  dayChange?: string;
  dayChangePercent?: string;
  avgCost?: string;
  priceTicks?: PriceTick[];
}

export interface PriceTick {
  time: string;
  value: number;
}

export interface TransactionsData {
  transactions: Transaction[];
  nextCursor?: string;
}

export interface Transaction {
  id: string;
  type: string;
  status?: string;
  isin?: string;
  securityName?: string;
  quantity?: string;
  price?: string;
  amount: string;
  currency?: string;
  date: string;
  settlementDate?: string;
  fee?: string;
}

export interface TransactionDetailData {
  transaction: Transaction;
  details?: Record<string, unknown>;
}

export interface QuoteData {
  isin: string;
  name?: string;
  price: string;
  currency?: string;
  dayChange?: string;
  dayChangePercent?: string;
  marketCap?: string;
  pe?: string;
  dividendYield?: string;
  beta?: string;
  high52w?: string;
  low52w?: string;
  bidPrice?: string;
  askPrice?: string;
}

export interface ChartData {
  isin: string;
  timeframe: string;
  points: ChartPoint[];
}

export interface ChartPoint {
  time: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

export interface SecurityNewsData {
  news: NewsItem[];
}

export interface NewsItem {
  title: string;
  summary?: string;
  source?: string;
  url?: string;
  publishedAt?: string;
}

export interface WatchlistData {
  items: WatchlistItem[];
}

export interface WatchlistItem {
  isin: string;
  name?: string;
  price?: string;
  dayChange?: string;
  dayChangePercent?: string;
}

export interface PriceAlertsData {
  alerts: PriceAlert[];
}

export interface PriceAlert {
  id: string;
  isin?: string;
  ticker?: string;
  name?: string;
  targetPrice: string;
  currentPrice?: string;
  status?: string;
}

export interface SavingsPlansData {
  plans: SavingsPlan[];
}

export interface SavingsPlan {
  isin: string;
  name?: string;
  amount: string;
  frequency?: string;
  nextExecution?: string;
  status?: string;
}

export interface SavingsPlanConfigData {
  isin: string;
  minAmount?: string;
  maxAmount?: string;
  frequencies?: string[];
  paymentMethods?: string[];
}

export interface TradePreviewData {
  confirmationId: string;
  isin: string;
  side: "buy" | "sell";
  orderType: string;
  quantity?: string;
  amount?: string;
  price?: string;
  totalCost?: string;
  fees?: string;
  warnings?: string[];
  suitable?: boolean;
}

export interface TradeSubmitData {
  orderId: string;
  status: string;
  isin: string;
  side: "buy" | "sell";
  quantity?: string;
  amount?: string;
}

export interface TradeCancelData {
  orderId: string;
  status: string;
}

// Shapes below mirror the `sc --json` projections (snake_case keys),
// see src/broker_projections.rs in the CLI.

export interface SearchData {
  result: {
    count: number;
    items: SearchResult[];
  };
}

export interface SearchResult {
  isin: string;
  name: string | null;
  security_type?: string | null;
  quote_mid_price?: number | null;
  quote_currency?: string | null;
  quote_timestamp_utc?: string | null;
  quote_is_outdated?: boolean | null;
}

export interface DerivativesData {
  result: {
    underlying_isin?: string;
    derivative_type?: string;
    offset?: number;
    limit?: number;
    total_available?: number | null;
    count: number;
    items: Derivative[];
  };
}

export interface DerivativePrice {
  kind: "money" | "point";
  currency_iso_code: string | null;
  value: number | null;
}

export interface Derivative {
  isin: string;
  underlying_isin: string | null;
  issuer: string | null;
  strategy: string | null;
  product_subcategory: string | null;
  leverage: number | null;
  factor: number | null;
  omega: number | null;
  delta: number | null;
  implied_volatility: number | null;
  distance_to_knockout: number | null;
  distance_to_strike: number | null;
  strike: DerivativePrice | null;
  knockout_barrier: DerivativePrice | null;
  premium_absolute: { currency_iso_code: string | null; value: number | null } | null;
  premium_percentage: number | null;
  expiry_date: { date: string | null; epoch_day: number | null } | null;
  expiry_is_open_end: boolean | null;
}

export interface PortfolioGroupsData {
  groups: PortfolioGroup[];
  ungroupedItems?: Holding[];
}

export interface PortfolioGroup {
  id: string;
  name: string;
  description?: string;
  items: Holding[];
  totalValue?: string;
  totalReturn?: string;
  totalReturnPercent?: string;
}

export interface CapabilitiesData {
  commands: string[];
  localTradeControls?: {
    allowedIsins?: string[];
    deniedIsins?: string[];
    maxOrderNotional?: string;
  };
}
