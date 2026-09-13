import { api } from "../../api/client";
import type { Transaction } from "../../api/types";
import {
  FEE_KEY_PATTERN,
  TAX_KEY_PATTERN,
  fetchAllTransactions,
  isoEndOfDay,
  isoStartOfDay,
  mapWithConcurrency,
  sumByKeyPattern,
  toDateInputValue,
  yearOf,
} from "./reportUtils";

/** Cost-report pipeline: paging `get_transactions` over a date range, then
 * enriching a bounded, capped sample of trade rows via
 * `get_transaction_detail`. Split out of CostReport.tsx so the component file
 * stays a thin view over this aggregation. */

export const PAGE_SIZE = 100;
const TRADE_ROW_TYPES = new Set(["BUY", "SELL"]);
const DIRECT_COST_TYPES = new Set(["FEE", "TAX", "TAX_RETURN"]);
// Enriching a row costs one `get_transaction_detail` call, so the number
// enriched is capped and the cap is always reported back to the caller —
// never silently truncated.
export const MAX_ENRICH = 50;
const ENRICH_CONCURRENCY = 4;

export interface YearBucket {
  year: string;
  fees: number;
  taxes: number;
  total: number;
}

export interface TypeBucket {
  type: string;
  fees: number;
  taxes: number;
  count: number;
}

export interface CostReportResult {
  yearBuckets: YearBucket[];
  typeBuckets: TypeBucket[];
  tradeRowCount: number;
  enrichedCount: number;
  hasData: boolean;
}

export interface CostReportProgress {
  paged: number;
  enrichedDone: number;
  enrichedTotal: number;
}

export function defaultCostRange(): { from: string; to: string } {
  const now = new Date();
  const to = toDateInputValue(now);
  const from = toDateInputValue(new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)));
  return { from, to };
}

function addToYear(map: Map<string, YearBucket>, year: string, fees: number, taxes: number) {
  const bucket = map.get(year) ?? { year, fees: 0, taxes: 0, total: 0 };
  bucket.fees += fees;
  bucket.taxes += taxes;
  bucket.total = bucket.fees + bucket.taxes;
  map.set(year, bucket);
}

function addToType(map: Map<string, TypeBucket>, type: string, fees: number, taxes: number) {
  const bucket = map.get(type) ?? { type, fees: 0, taxes: 0, count: 0 };
  bucket.fees += fees;
  bucket.taxes += taxes;
  bucket.count += 1;
  map.set(type, bucket);
}

export function buildCostTxParams(portfolioId: string | undefined, from: string, to: string) {
  return { portfolioId, fromTime: isoStartOfDay(from), toTime: isoEndOfDay(to) };
}

/**
 * Runs the full pipeline for one date range: page every transaction in
 * range, aggregate FEE/TAX/TAX_RETURN cash entries directly (their `amount`
 * is already on the list row), then enrich up to `MAX_ENRICH` BUY/SELL rows
 * with bounded concurrency to pull whatever fee/tax figures their detail
 * payload happens to carry.
 */
export async function runCostReport(
  portfolioId: string | undefined,
  from: string,
  to: string,
  onProgress?: (p: CostReportProgress) => void
): Promise<CostReportResult> {
  const params = buildCostTxParams(portfolioId, from, to);
  let paged = 0;
  const all = await fetchAllTransactions(params, PAGE_SIZE, (p) => {
    paged = p.loaded;
    onProgress?.({ paged, enrichedDone: 0, enrichedTotal: 0 });
  });

  const yearMap = new Map<string, YearBucket>();
  const typeMap = new Map<string, TypeBucket>();

  const directRows = all.filter((tx) => DIRECT_COST_TYPES.has(tx.type));
  for (const tx of directRows) {
    const year = yearOf(tx.last_event_datetime);
    const amount = tx.amount ?? 0;
    const fees = tx.type === "FEE" ? amount : 0;
    const taxes = tx.type === "TAX" || tx.type === "TAX_RETURN" ? amount : 0;
    addToYear(yearMap, year, fees, taxes);
    addToType(typeMap, tx.type, fees, taxes);
  }

  const tradeRows = all.filter((tx) => TRADE_ROW_TYPES.has(tx.type));
  const toEnrich = tradeRows.slice(0, MAX_ENRICH);

  const enriched = await mapWithConcurrency<Transaction, { fees: number; taxes: number }>(
    toEnrich,
    ENRICH_CONCURRENCY,
    async (tx) => {
      try {
        const detail = await api.getTransactionDetail(tx.id, portfolioId);
        const result = detail?.result ?? {};
        return {
          fees: sumByKeyPattern(result, FEE_KEY_PATTERN),
          taxes: sumByKeyPattern(result, TAX_KEY_PATTERN),
        };
      } catch {
        return { fees: 0, taxes: 0 };
      }
    },
    (done) => onProgress?.({ paged, enrichedDone: done, enrichedTotal: toEnrich.length })
  );

  toEnrich.forEach((tx, i) => {
    const year = yearOf(tx.last_event_datetime);
    const { fees, taxes } = enriched[i] ?? { fees: 0, taxes: 0 };
    addToYear(yearMap, year, fees, taxes);
    addToType(typeMap, tx.type, fees, taxes);
  });

  return {
    yearBuckets: [...yearMap.values()].sort((a, b) => a.year.localeCompare(b.year)),
    typeBuckets: [...typeMap.values()].sort((a, b) => b.fees + b.taxes - (a.fees + a.taxes)),
    tradeRowCount: tradeRows.length,
    enrichedCount: toEnrich.length,
    hasData: directRows.length > 0 || toEnrich.length > 0,
  };
}
