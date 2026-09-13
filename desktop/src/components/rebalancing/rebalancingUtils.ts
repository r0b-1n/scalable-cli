import type { Holding, TradeSide } from "../../api/types";

const STORAGE_PREFIX = "sc-desktop-rebalancing-targets";

/** Per-portfolio so switching portfolios never mixes up target weights. */
function storageKey(portfolioId: string | undefined): string {
  return `${STORAGE_PREFIX}:${portfolioId || "default"}`;
}

/** localStorage can throw (private browsing, blocked site data) or simply be
 * absent — every access is wrapped so a storage failure never breaks the
 * screen, it just falls back to an empty target set. */
export function loadTargets(portfolioId: string | undefined): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey(portfolioId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveTargets(portfolioId: string | undefined, targets: Record<string, number>): void {
  try {
    localStorage.setItem(storageKey(portfolioId), JSON.stringify(targets));
  } catch {
    // Best-effort persistence only — an unavailable store just means targets
    // reset next visit, which is safe.
  }
}

/** Evenly splits 100% across every holding, nudging the last row so the sum
 * is exactly 100 regardless of rounding. */
export function equalWeightTargets(holdings: Holding[]): Record<string, number> {
  const n = holdings.length;
  if (n === 0) return {};
  const each = Math.round((100 / n) * 100) / 100;
  const targets: Record<string, number> = {};
  let assigned = 0;
  holdings.forEach((h, i) => {
    if (i === n - 1) {
      targets[h.isin] = Math.round((100 - assigned) * 100) / 100;
    } else {
      targets[h.isin] = each;
      assigned += each;
    }
  });
  return targets;
}

/** Copies each holding's current (actual) weight in as its target. */
export function currentWeightTargets(holdings: Holding[], totalValuation: number): Record<string, number> {
  const targets: Record<string, number> = {};
  for (const h of holdings) {
    targets[h.isin] = totalValuation > 0 ? Math.round(((h.valuation ?? 0) / totalValuation) * 10000) / 100 : 0;
  }
  return targets;
}

export interface PlanRow {
  isin: string;
  name: string;
  currency: string;
  currentValue: number;
  targetValue: number;
  diff: number;
  side: TradeSide | "hold";
  /** Best-effort share estimate for a sell prefill (the CLI takes `--shares`,
   * not `--amount`, on a sell). */
  estimatedShares: number | null;
  inBand: boolean;
}

/** Per holding, the buy/sell needed to reach its target — respecting the
 * tolerance band, so a small drift is left alone rather than churned. */
export function buildPlan(
  holdings: Holding[],
  targets: Record<string, number>,
  totalValuation: number,
  tolerancePct: number
): PlanRow[] {
  return holdings.map((h) => {
    const currentValue = h.valuation ?? 0;
    const targetPct = targets[h.isin] ?? 0;
    const targetValue = (targetPct / 100) * totalValuation;
    const diff = targetValue - currentValue;
    const driftPct = totalValuation > 0 ? (currentValue / totalValuation) * 100 - targetPct : 0;
    const inBand = Math.abs(driftPct) <= tolerancePct;
    const side: TradeSide | "hold" = inBand ? "hold" : diff > 0 ? "buy" : "sell";
    const price = h.quote_mid_price || h.fifo_price || 0;
    return {
      isin: h.isin,
      name: h.name || h.isin,
      currency: h.valuation_currency || "EUR",
      currentValue,
      targetValue,
      diff,
      side,
      estimatedShares: price > 0 ? Math.abs(diff) / price : null,
      inBand,
    };
  });
}
