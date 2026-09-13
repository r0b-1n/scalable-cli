/**
 * Reconstructs the `sc` command line behind every IPC call, and keeps a
 * bounded in-memory log of what the app has run this session.
 *
 * The CLI is the product: every screen can show (and copy) the exact command
 * that produced the data on it, so nothing the app does is opaque and anything
 * it does can be reproduced in a terminal or a script.
 *
 * The mapping intentionally mirrors `desktop/src-tauri/src/commands/*.rs`. It
 * is display-only — it never builds the argv that actually runs.
 */

export interface CliCall {
  id: number;
  /** The Tauri command name, e.g. `get_holdings`. */
  command: string;
  /** The rendered command line, e.g. `sc broker holdings --json`. */
  cli: string;
  startedAt: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

type Args = Record<string, unknown> | undefined;

/** One `sc` argv template per Tauri command. */
type Builder = (a: Args) => string[];

const str = (a: Args, k: string): string | undefined => {
  const v = a?.[k];
  return typeof v === "string" && v.length > 0 ? v : undefined;
};
const num = (a: Args, k: string): string | undefined => {
  const v = a?.[k];
  return typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;
};
const bool = (a: Args, k: string): boolean => a?.[k] === true;
const list = (a: Args, k: string): string[] => {
  const v = a?.[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

/** Append `--flag value` when the value is present. */
function opt(out: string[], flag: string, value: string | undefined) {
  if (value !== undefined) out.push(flag, value);
}
/** Append `--flag` when the boolean is set. */
function flag(out: string[], name: string, on: boolean) {
  if (on) out.push(name);
}
/** Append a repeatable `--flag value` for each entry. */
function each(out: string[], name: string, values: string[]) {
  for (const v of values) out.push(name, v);
}

/** Flags shared by the quote-backed read commands. */
function quoteOpts(out: string[], a: Args) {
  flag(out, "--include-year-to-date", bool(a, "includeYearToDate"));
  opt(out, "--quote-source", str(a, "quoteSource"));
}
function portfolio(out: string[], a: Args) {
  opt(out, "--portfolio-id", str(a, "portfolioId"));
}

const BUILDERS: Record<string, Builder> = {
  login: (a) => ["login", ...(bool(a, "localReadOnly") ? ["--local-read-only"] : [])],
  logout: () => ["logout"],
  get_whoami: () => ["whoami"],
  get_capabilities: () => ["capabilities"],

  get_broker_context: () => ["broker", "context", "show"],
  list_broker_portfolios: () => ["broker", "context", "list"],
  select_broker_context: (a) => [
    "broker",
    "context",
    "select",
    "--portfolio-id",
    str(a, "portfolioId") ?? "<portfolio-id>",
  ],

  get_overnight: (a) => {
    const out = ["overnight"];
    opt(out, "--savings-account-id", str(a, "savingsAccountId"));
    return out;
  },
  get_overnight_transactions: (a) => {
    const out = ["overnight", "transactions"];
    opt(out, "--savings-account-id", str(a, "savingsAccountId"));
    opt(out, "--page-size", num(a, "pageSize"));
    opt(out, "--cursor", str(a, "cursor"));
    each(out, "--type-filter", list(a, "typeFilter"));
    opt(out, "--search-term", str(a, "searchTerm"));
    opt(out, "--from-time", str(a, "fromTime"));
    opt(out, "--to-time", str(a, "toTime"));
    return out;
  },

  get_broker_overview: (a) => {
    const out = ["broker", "overview"];
    portfolio(out, a);
    flag(out, "--include-year-to-date", bool(a, "includeYearToDate"));
    return out;
  },
  get_broker_analytics: (a) => {
    const out = ["broker", "analytics"];
    portfolio(out, a);
    return out;
  },
  get_broker_cash_breakdown: (a) => {
    const out = ["broker", "cash-breakdown"];
    portfolio(out, a);
    return out;
  },
  get_holdings: (a) => {
    const out = ["broker", "holdings"];
    portfolio(out, a);
    quoteOpts(out, a);
    return out;
  },

  get_transactions: (a) => {
    const out = ["broker", "transactions"];
    portfolio(out, a);
    opt(out, "--page-size", num(a, "pageSize"));
    opt(out, "--cursor", str(a, "cursor"));
    each(out, "--type-filter", list(a, "typeFilter"));
    each(out, "--status", list(a, "status"));
    opt(out, "--search-term", str(a, "searchTerm"));
    opt(out, "--isin", str(a, "isin"));
    opt(out, "--from-time", str(a, "fromTime"));
    opt(out, "--to-time", str(a, "toTime"));
    flag(out, "--include-reinvestment-subtypes", bool(a, "includeReinvestmentSubtypes"));
    return out;
  },
  get_transaction_detail: (a) => {
    const out = [
      "broker",
      "transaction",
      "details",
      "--transaction-id",
      str(a, "transactionId") ?? "<transaction-id>",
    ];
    portfolio(out, a);
    return out;
  },

  get_quote: (a) => {
    const out = ["broker", "quote", "--isin", str(a, "isin") ?? "<isin>"];
    portfolio(out, a);
    quoteOpts(out, a);
    return out;
  },
  get_chart: (a) => [
    "broker",
    "chart",
    "--isin",
    str(a, "isin") ?? "<isin>",
    "--timeframe",
    str(a, "timeframe") ?? "1m",
  ],
  get_security_news: (a) => {
    const out = ["broker", "security-news", "--isin", str(a, "isin") ?? "<isin>"];
    opt(out, "--locale", str(a, "locale"));
    return out;
  },
  search_securities: (a) => {
    const out = ["broker", "search", str(a, "query") ?? "<query>"];
    portfolio(out, a);
    quoteOpts(out, a);
    return out;
  },
  search_derivatives: (a) => {
    const out = [
      "broker",
      "derivatives",
      "search",
      "--underlying",
      str(a, "underlying") ?? "<isin>",
      "--type",
      str(a, "derivativeType") ?? "knockout",
      "--strategy",
      str(a, "strategy") ?? "long",
    ];
    opt(out, "--limit", num(a, "limit"));
    opt(out, "--offset", num(a, "offset"));
    each(out, "--issuer", list(a, "issuer"));
    each(out, "--product-subcategory", list(a, "productSubcategory"));
    for (const [flagName, key] of [
      ["--leverage-min", "leverageMin"],
      ["--leverage-max", "leverageMax"],
      ["--knockout-barrier-min", "knockoutBarrierMin"],
      ["--knockout-barrier-max", "knockoutBarrierMax"],
      ["--strike-min", "strikeMin"],
      ["--strike-max", "strikeMax"],
      ["--omega-min", "omegaMin"],
      ["--omega-max", "omegaMax"],
      ["--delta-min", "deltaMin"],
      ["--delta-max", "deltaMax"],
      ["--factor-min", "factorMin"],
      ["--factor-max", "factorMax"],
      ["--expiry-from", "expiryFrom"],
      ["--expiry-to", "expiryTo"],
      ["--sort-field", "sortField"],
      ["--sort-order", "sortOrder"],
    ] as const) {
      opt(out, flagName, str(a, key));
    }
    portfolio(out, a);
    return out;
  },

  get_watchlist: (a) => {
    const out = ["broker", "watchlist"];
    portfolio(out, a);
    quoteOpts(out, a);
    return out;
  },
  add_to_watchlist: (a) => {
    const out = ["broker", "watchlist", "add", "--isin", str(a, "isin") ?? "<isin>"];
    portfolio(out, a);
    return out;
  },
  remove_from_watchlist: (a) => {
    const out = ["broker", "watchlist", "remove", "--isin", str(a, "isin") ?? "<isin>"];
    portfolio(out, a);
    return out;
  },

  get_price_alerts: (a) => {
    const out = ["broker", "price-alerts"];
    portfolio(out, a);
    flag(out, "--active-only", bool(a, "activeOnly"));
    return out;
  },
  add_price_alert: (a) => {
    const out = ["broker", "price-alerts", "add"];
    opt(out, "--isin", str(a, "isin"));
    opt(out, "--ticker", str(a, "ticker"));
    opt(out, "--price", str(a, "price"));
    portfolio(out, a);
    return out;
  },
  remove_price_alert: (a) => {
    const out = [
      "broker",
      "price-alerts",
      "remove",
      "--alert-id",
      str(a, "alertId") ?? "<alert-id>",
    ];
    portfolio(out, a);
    return out;
  },

  get_savings_plans: (a) => {
    const out = ["broker", "savings-plans"];
    portfolio(out, a);
    return out;
  },
  get_savings_plan_config: (a) => {
    const out = ["broker", "savings-plans", "config", "--isin", str(a, "isin") ?? "<isin>"];
    portfolio(out, a);
    return out;
  },
  add_savings_plan: (a) => {
    const out = [
      "broker",
      "savings-plans",
      "add",
      "--isin",
      str(a, "isin") ?? "<isin>",
      "--amount",
      str(a, "amount") ?? "<amount>",
    ];
    opt(out, "--frequency", str(a, "frequency"));
    opt(out, "--day-of-month", num(a, "dayOfMonth"));
    opt(out, "--year-month", str(a, "yearMonth"));
    opt(out, "--dynamization-rate", str(a, "dynamizationRate"));
    opt(out, "--payment-method", str(a, "paymentMethod"));
    opt(out, "--appropriateness-id", str(a, "appropriatenessId"));
    opt(
      out,
      "--acknowledged-appropriateness-warning-version",
      str(a, "acknowledgedAppropriatenessWarningVersion")
    );
    portfolio(out, a);
    opt(out, "--confirm", str(a, "confirm"));
    return out;
  },
  remove_savings_plan: (a) => {
    const out = ["broker", "savings-plans", "remove", "--isin", str(a, "isin") ?? "<isin>"];
    portfolio(out, a);
    return out;
  },

  trade_preview: (a) => tradeArgs(a, undefined),
  trade_submit: (a) => tradeArgs(a, str(a, "confirmationId") ?? "<confirmation-id>"),
  trade_cancel: (a) => {
    const out = [
      "broker",
      "trade",
      "cancel",
      "--order-id",
      str(a, "orderId") ?? "<order-id>",
    ];
    portfolio(out, a);
    return out;
  },

  get_portfolio_groups: (a) => {
    const out = ["broker", "portfolio-groups"];
    portfolio(out, a);
    opt(out, "--group-id", str(a, "groupId"));
    return out;
  },
  create_portfolio_group: (a) => {
    const out = [
      "broker",
      "portfolio-groups",
      "create",
      "--name",
      str(a, "name") ?? "<name>",
    ];
    opt(out, "--description", str(a, "description"));
    portfolio(out, a);
    return out;
  },
  update_portfolio_group: (a) => {
    const out = [
      "broker",
      "portfolio-groups",
      "update",
      "--group-id",
      str(a, "groupId") ?? "<group-id>",
    ];
    opt(out, "--name", str(a, "name"));
    opt(out, "--description", str(a, "description"));
    flag(out, "--clear-description", bool(a, "clearDescription"));
    portfolio(out, a);
    return out;
  },
  delete_portfolio_group: (a) => {
    const out = [
      "broker",
      "portfolio-groups",
      "delete",
      "--group-id",
      str(a, "groupId") ?? "<group-id>",
    ];
    portfolio(out, a);
    return out;
  },
  assign_to_group: (a) => groupItemArgs(a, "assign"),
  unassign_from_group: (a) => groupItemArgs(a, "unassign"),
};

function tradeArgs(a: Args, confirmationId: string | undefined): string[] {
  const out = ["broker", "trade", str(a, "side") ?? "buy"];
  opt(out, "--isin", str(a, "isin"));
  opt(out, "--amount", str(a, "amount"));
  opt(out, "--shares", str(a, "shares"));
  opt(out, "--order-type", str(a, "orderType"));
  opt(out, "--limit-price", str(a, "limitPrice"));
  opt(out, "--stop-price", str(a, "stopPrice"));
  opt(out, "--venue", str(a, "venue"));
  portfolio(out, a);
  if (confirmationId !== undefined) {
    out.push("--confirm", confirmationId);
    flag(out, "--accept-unsuitable", bool(a, "acceptUnsuitable"));
  }
  return out;
}

function groupItemArgs(a: Args, verb: "assign" | "unassign"): string[] {
  const out = [
    "broker",
    "portfolio-groups",
    verb,
    "--group-id",
    str(a, "groupId") ?? "<group-id>",
  ];
  each(out, "--isin", list(a, "isin"));
  portfolio(out, a);
  return out;
}

/** Quote an argv entry only when the shell would need it. */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_\-.:/=+@]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `sc` command line for a Tauri command + its arguments. `login` is the
 * one command with no `--json` mode, so it is the one line rendered without it.
 */
export function renderCliCommand(command: string, args?: Record<string, unknown>): string {
  const build = BUILDERS[command];
  if (!build) return `sc ${command}`;
  const argv = build(args);
  const withJson = command === "login" ? argv : [...argv, "--json"];
  return ["sc", ...withJson.map(shellQuote)].join(" ");
}

const MAX_ENTRIES = 200;
let nextId = 1;
let entries: CliCall[] = [];
const listeners = new Set<(calls: CliCall[]) => void>();

export function recordCliCall(input: {
  command: string;
  args?: Record<string, unknown>;
  startedAt: number;
  ok: boolean;
  error?: string;
}) {
  const entry: CliCall = {
    id: nextId++,
    command: input.command,
    cli: renderCliCommand(input.command, input.args),
    startedAt: input.startedAt,
    durationMs: Date.now() - input.startedAt,
    ok: input.ok,
    error: input.error,
  };
  // Newest first, bounded — this is a session aid, not an audit log.
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  for (const listener of listeners) listener(entries);
}

export function getCliCalls(): CliCall[] {
  return entries;
}

export function clearCliCalls() {
  entries = [];
  for (const listener of listeners) listener(entries);
}

export function subscribeCliCalls(listener: (calls: CliCall[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
