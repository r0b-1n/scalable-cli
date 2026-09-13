import { api } from "../../api/client";
import type { Transaction } from "../../api/types";

/** Same ISIN shape check the trade ticket uses before firing a lookup. */
export const ISIN_PATTERN = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/;

/** `sc`'s savings-plan frequency values are kebab-case (`bi-monthly`); the
 * translated map is keyed the way `enumLabel` expects (`BI_MONTHLY`). */
export function frequencyKey(raw: string): string {
  return raw.toUpperCase().replace(/-/g, "_");
}

const MAX_PAGES = 50;

/**
 * Pages `get_transactions` to exhaustion for one filter set (used to sum
 * every `SAVINGS_PLAN` transaction per ISIN — there is no single `sc` command
 * that reports "contributed so far", so this reconstructs it from the ledger).
 * Bounded defensively: a runaway cursor must never hang the screen.
 */
export async function fetchAllTransactions(
  params: {
    portfolioId?: string;
    typeFilter?: string[];
    isin?: string;
  },
  pageSize = 100,
  onProgress?: (loaded: number) => void
): Promise<Transaction[]> {
  const items: Transaction[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.getTransactions({ ...params, pageSize, cursor });
    const batch = res.result.items ?? [];
    items.push(...batch);
    onProgress?.(items.length);
    cursor = res.result.cursor ?? undefined;
    if (!cursor || batch.length === 0) break;
  }
  return items;
}
