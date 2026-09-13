/**
 * Shared helpers for the derivatives screen: label lookups for the enum
 * codes the CLI returns, the request-shape builder used by both `api.
 * getDerivatives` and the `CliCommand` preview (so they can never drift),
 * and the filter state the screen and its filter panel share.
 *
 * Issuer and product-subcategory codes are brand/product names, not UI
 * copy — they are not translated, just re-cased for display (the same way
 * an ISIN is shown verbatim regardless of language).
 */
import type {
  Derivative,
  DerivativeIssuer,
  DerivativeSortField,
  DerivativeStrategy,
  DerivativeSubcategory,
  DerivativeType,
  DerivativeValue,
  SortOrder,
} from "../../api/types";
import type { Translations } from "../../i18n";
import { formatNumber } from "../../lib/format";

export const ISIN_PATTERN = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/;

export const ALL_ISSUERS: DerivativeIssuer[] = [
  "goldman-sachs",
  "hsbc",
  "hvb",
  "bnp",
  "vontobel",
  "morgan-stanley",
  "soc-gen",
];

export const ALL_SUBCATEGORIES: DerivativeSubcategory[] = ["mini-future", "turbo"];

const ISSUER_LABELS: Partial<Record<DerivativeIssuer, string>> = {
  "goldman-sachs": "Goldman Sachs",
  hsbc: "HSBC",
  hvb: "HypoVereinsbank (HVB)",
  bnp: "BNP Paribas",
  vontobel: "Vontobel",
  "morgan-stanley": "Morgan Stanley",
  "soc-gen": "Société Générale",
};

const SUBCATEGORY_LABELS: Partial<Record<DerivativeSubcategory, string>> = {
  "mini-future": "Mini Future",
  turbo: "Turbo",
};

function prettify(code: string): string {
  const clean = code.replace(/[-_]/g, " ").trim();
  if (!clean) return code;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function issuerLabel(code: string): string {
  return ISSUER_LABELS[code as DerivativeIssuer] ?? prettify(code);
}

export function subcategoryLabel(code: string): string {
  return SUBCATEGORY_LABELS[code as DerivativeSubcategory] ?? prettify(code);
}

/** Warrants trade call/put; every other family trades long/short. */
export function strategyOptionsFor(type: DerivativeType): DerivativeStrategy[] {
  return type === "warrant" ? ["call", "put"] : ["long", "short"];
}

/** Keep the same market direction when the family changes (long≈call, short≈put). */
export function carryStrategy(
  current: DerivativeStrategy,
  nextType: DerivativeType
): DerivativeStrategy {
  const options = strategyOptionsFor(nextType);
  if (options.includes(current)) return current;
  const wasBullish = current === "long" || current === "call";
  return wasBullish ? options[0] : options[1];
}

export function formatDerivativeValue(v: DerivativeValue | null | undefined): string {
  if (!v || v.value == null) return "—";
  const num = formatNumber(v.value);
  return v.kind === "money" && v.currency_iso_code ? `${num} ${v.currency_iso_code}` : num;
}

/** Sort fields relevant to the chosen product family, labelled via the existing derivatives.* keys. */
export function sortFieldOptions(
  type: DerivativeType,
  t: Translations
): { value: DerivativeSortField; label: string }[] {
  const shared: { value: DerivativeSortField; label: string }[] = [
    { value: "premium-absolute", label: t.derivatives.premium },
    { value: "premium-relative", label: `${t.derivatives.premium} %` },
    { value: "expiry-date", label: t.derivatives.expiry },
  ];
  if (type === "factor") {
    return [{ value: "factor", label: t.derivatives.factor }, ...shared];
  }
  const withStrike: { value: DerivativeSortField; label: string }[] = [
    { value: "leverage", label: t.derivatives.leverage },
    { value: "strike", label: t.derivatives.strike },
    { value: "distance-to-strike", label: t.derivatives.distanceToStrike },
    ...shared,
  ];
  if (type === "knockout") {
    return [
      ...withStrike,
      { value: "knockout-barrier", label: t.derivatives.barrier },
      { value: "distance-to-knockout", label: t.derivatives.distanceToBarrier },
    ];
  }
  // warrant
  return [
    ...withStrike,
    { value: "omega", label: t.derivatives.omega },
    { value: "delta", label: t.derivatives.delta },
    { value: "implied-volatility", label: t.derivatives.impliedVolatility },
  ];
}

export interface DerivativeFilterState {
  issuer: DerivativeIssuer[];
  productSubcategory: DerivativeSubcategory[];
  leverageMin: string;
  leverageMax: string;
  knockoutBarrierMin: string;
  knockoutBarrierMax: string;
  strikeMin: string;
  strikeMax: string;
  omegaMin: string;
  omegaMax: string;
  deltaMin: string;
  deltaMax: string;
  factorMin: string;
  factorMax: string;
  expiryFrom: string;
  expiryTo: string;
  sortField: DerivativeSortField | "";
  sortOrder: SortOrder;
}

export const DEFAULT_DERIVATIVE_FILTERS: DerivativeFilterState = {
  issuer: [],
  productSubcategory: [],
  leverageMin: "",
  leverageMax: "",
  knockoutBarrierMin: "",
  knockoutBarrierMax: "",
  strikeMin: "",
  strikeMax: "",
  omegaMin: "",
  omegaMax: "",
  deltaMin: "",
  deltaMax: "",
  factorMin: "",
  factorMax: "",
  expiryFrom: "",
  expiryTo: "",
  sortField: "",
  sortOrder: "asc",
};

export const DEFAULT_DERIVATIVES_LIMIT = 25;
export const DERIVATIVES_LIMIT_OPTIONS = [10, 25, 50, 100];

/**
 * Builds the exact params object `api.getDerivatives` and
 * `renderCliCommand("search_derivatives", …)` both consume, so the CLI
 * command shown on screen can never drift from the request actually sent.
 */
export function buildDerivativeParams(args: {
  underlying: string;
  derivativeType: DerivativeType;
  strategy: DerivativeStrategy;
  filters: DerivativeFilterState;
  limit: number;
  offset: number;
  portfolioId?: string;
}) {
  const { underlying, derivativeType, strategy, filters, limit, offset, portfolioId } = args;
  return {
    underlying,
    derivativeType,
    strategy,
    limit,
    offset,
    portfolioId,
    issuer: filters.issuer.length ? filters.issuer : undefined,
    productSubcategory: filters.productSubcategory.length ? filters.productSubcategory : undefined,
    leverageMin: filters.leverageMin || undefined,
    leverageMax: filters.leverageMax || undefined,
    knockoutBarrierMin: filters.knockoutBarrierMin || undefined,
    knockoutBarrierMax: filters.knockoutBarrierMax || undefined,
    strikeMin: filters.strikeMin || undefined,
    strikeMax: filters.strikeMax || undefined,
    omegaMin: filters.omegaMin || undefined,
    omegaMax: filters.omegaMax || undefined,
    deltaMin: filters.deltaMin || undefined,
    deltaMax: filters.deltaMax || undefined,
    factorMin: filters.factorMin || undefined,
    factorMax: filters.factorMax || undefined,
    expiryFrom: filters.expiryFrom || undefined,
    expiryTo: filters.expiryTo || undefined,
    sortField: filters.sortField || undefined,
    sortOrder: filters.sortField ? filters.sortOrder : undefined,
  };
}

/** Best-effort numeric read for the combined omega/delta/factor column & sort. */
export function greekOrFactorSortValue(d: Derivative): number | null {
  if (d.factor != null) return d.factor;
  if (d.omega != null) return d.omega;
  if (d.delta != null) return d.delta;
  return null;
}

export function formatGreekOrFactor(d: Derivative): string {
  if (d.factor != null) return `${formatNumber(d.factor)}×`;
  const parts: string[] = [];
  if (d.omega != null) parts.push(`Ω ${formatNumber(d.omega)}`);
  if (d.delta != null) parts.push(`Δ ${formatNumber(d.delta)}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Distance-to-barrier for knockouts, distance-to-strike otherwise. */
export function distanceValue(d: Derivative): number | null {
  return d.distance_to_knockout ?? d.distance_to_strike ?? null;
}
