import { api } from "../../api/client";
import type { OvernightTransaction, Transaction } from "../../api/types";

/**
 * Shared plumbing for the two composite report screens: paging a cursor
 * endpoint to exhaustion, running a bounded pool of concurrent detail calls,
 * and the loose-JSON heuristics used to pull a fee/tax figure out of
 * `get_transaction_detail`'s open-ended payload.
 */

// Guards every "page through all of it" loop against a pathological cursor
// that never terminates — this is a session aid, not a promise the CLI keeps.
const SAFETY_MAX_PAGES = 300;

export interface FetchAllProgress {
  loaded: number;
  total: number | null;
}

type TransactionsParams = Omit<Parameters<typeof api.getTransactions>[0], "cursor" | "pageSize">;
type OvernightParams = Omit<Parameters<typeof api.getOvernightTransactions>[0], "cursor" | "pageSize">;

/** Pages `get_transactions` until its cursor is exhausted. */
export async function fetchAllTransactions(
  params: TransactionsParams,
  pageSize: number,
  onProgress?: (p: FetchAllProgress) => void
): Promise<Transaction[]> {
  const items: Transaction[] = [];
  let cursor: string | undefined;
  let total: number | null = null;
  for (let page = 0; page < SAFETY_MAX_PAGES; page++) {
    const res = await api.getTransactions({ ...params, pageSize, cursor });
    const data = res.result;
    items.push(...(data.items ?? []));
    total = data.total ?? total;
    onProgress?.({ loaded: items.length, total });
    cursor = data.cursor ?? undefined;
    if (!cursor) break;
  }
  return items;
}

/** Pages `get_overnight_transactions` until its cursor is exhausted. */
export async function fetchAllOvernightTransactions(
  params: OvernightParams,
  pageSize: number,
  onProgress?: (p: FetchAllProgress) => void
): Promise<OvernightTransaction[]> {
  const items: OvernightTransaction[] = [];
  let cursor: string | undefined;
  let total: number | null = null;
  for (let page = 0; page < SAFETY_MAX_PAGES; page++) {
    const res = await api.getOvernightTransactions({ ...params, pageSize, cursor });
    const data = res.result;
    items.push(...(data.items ?? []));
    total = data.total ?? total;
    onProgress?.({ loaded: items.length, total });
    cursor = data.cursor ?? undefined;
    if (!cursor) break;
  }
  return items;
}

/** Runs `fn` over `items` with at most `limit` calls in flight at once —
 * "a handful at a time" rather than one request per row or all at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      done++;
      onProgress?.(done, items.length);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export function yearOf(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : String(d.getFullYear());
}

export function monthKeyOf(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** `sc` mixes float and decimal-string amounts across endpoints (compare
 * `Transaction.amount: number` with `OvernightTransaction.amount: string` in
 * api/types.ts) — this reads either into a plain number for aggregation. */
export function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Keys that match a cost pattern but never hold a monetary leaf themselves —
// an id, a rate, a currency code, a percentage — so a keyword hit there must
// not be summed.
const EXCLUDE_KEY = /(?:^|[_-])(?:id|rate|percentage|percent|count|currency|type|kind|label|path|status|isin|iso)(?:$|[_-])/i;

function extractLeafAmount(v: unknown, depth: number): number {
  if (depth > 3) return 0;
  if (typeof v === "number" || typeof v === "string") return toNumber(v);
  if (isPlainObject(v)) {
    if ("amount" in v) return extractLeafAmount(v.amount, depth + 1);
    if ("total" in v) return extractLeafAmount(v.total, depth + 1);
    if ("value" in v) return extractLeafAmount(v.value, depth + 1);
  }
  return 0;
}

/**
 * Best-effort sum of every value whose key matches `pattern` anywhere inside
 * a loosely-shaped object, e.g. a transaction detail's fee/tax breakdown.
 * `get_transaction_detail` has no fixed schema across transaction types, so
 * this is a heuristic used only to build the cost report's aggregate charts —
 * never presented as an authoritative figure without the report's own
 * derived-data disclosure alongside it.
 */
export function sumByKeyPattern(obj: unknown, pattern: RegExp, depth = 0): number {
  if (depth > 5 || !isPlainObject(obj)) return 0;
  let sum = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (pattern.test(k) && !EXCLUDE_KEY.test(k)) {
      sum += extractLeafAmount(v, 0);
    } else if (v && typeof v === "object") {
      sum += sumByKeyPattern(v, pattern, depth + 1);
    }
  }
  return sum;
}

export const FEE_KEY_PATTERN = /fee|commission/i;
export const TAX_KEY_PATTERN = /tax/i;

export function isoStartOfDay(dateInput: string): string {
  return new Date(`${dateInput}T00:00:00.000Z`).toISOString();
}

export function isoEndOfDay(dateInput: string): string {
  return new Date(`${dateInput}T23:59:59.999Z`).toISOString();
}

export function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}
