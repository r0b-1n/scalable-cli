import { useMemo } from "react";
import Badge from "../ui/Badge";
import { formatCurrency, formatNumber, formatPercent } from "../../lib/format";
import { enumLabel, type Translations } from "../../i18n";
import type { Column } from "../ui/DataTable";
import type { Holding, TradeSide } from "../../api/types";
import { AlertTriangle, Clock, Lock, ShoppingCart, Star, TrendingDown } from "lucide-react";

/** since-buy P&L for one holding: absolute (account currency) and percent. */
export function sinceBuy(h: Holding): { abs: number; pct: number } {
  const abs =
    h.fifo_price != null && h.quote_mid_price != null
      ? (h.quote_mid_price - h.fifo_price) * h.quantity
      : 0;
  const pct = h.fifo_price ? (h.quote_mid_price / h.fifo_price - 1) * 100 : 0;
  return { abs, pct };
}

interface BuildColumnsOptions {
  t: Translations;
  selected: Set<string>;
  toggleSelected: (isin: string) => void;
  toggleSelectAll: () => void;
  holdingsCount: number;
  totalValuation: number;
  hasYTD: boolean;
  onTrade: (side: TradeSide, isin: string) => void;
  onAddToWatchlist: (isin: string) => void;
}

/**
 * Column set for the holdings `DataTable`. Kept out of Portfolio.tsx purely
 * to keep that file's line count manageable — nothing here is reusable
 * elsewhere.
 */
export function useHoldingsColumns(opts: BuildColumnsOptions): Column<Holding>[] {
  const {
    t,
    selected,
    toggleSelected,
    toggleSelectAll,
    holdingsCount,
    totalValuation,
    hasYTD,
    onTrade,
    onAddToWatchlist,
  } = opts;

  return useMemo(() => {
    const cols: Column<Holding>[] = [
      {
        key: "select",
        header: (
          <input
            type="checkbox"
            aria-label={t.groups.selectItems}
            checked={holdingsCount > 0 && selected.size === holdingsCount}
            onChange={toggleSelectAll}
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer"
          />
        ),
        cell: (h) => (
          <input
            type="checkbox"
            aria-label={`${t.groups.selectItems}: ${h.name || h.isin}`}
            checked={selected.has(h.isin)}
            onChange={() => toggleSelected(h.isin)}
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer"
          />
        ),
      },
      {
        key: "security",
        header: t.portfolio.colSecurity,
        sortValue: (h) => h.name || h.isin,
        exportValue: (h) => `${h.name || h.isin} (${h.isin})`,
        cell: (h) => (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-inset text-xs font-semibold text-text-tertiary">
              {(h.name || h.isin || "?").charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">{h.name || h.isin}</p>
              <p className="text-2xs text-text-tertiary">{h.isin}</p>
            </div>
          </div>
        ),
      },
      {
        key: "type",
        header: t.transactions.colType,
        hideNarrow: true,
        sortValue: (h) => h.security_type,
        exportValue: (h) => enumLabel(t.common.securityTypes, h.security_type),
        cell: (h) => <Badge>{enumLabel(t.common.securityTypes, h.security_type)}</Badge>,
      },
      {
        key: "quantity",
        header: t.portfolio.colQuantity,
        align: "right",
        sortValue: (h) => h.quantity,
        exportValue: (h) => h.quantity,
        cell: (h) => (
          <div className="flex flex-col items-end gap-1">
            <span>{formatNumber(h.quantity)}</span>
            {(h.blocked_quantity > 0 || h.pending_quantity > 0) && (
              <span className="flex items-center gap-1">
                {h.blocked_quantity > 0 && (
                  <span title={`${t.portfolio.colQuantity}: ${formatNumber(h.blocked_quantity)}`}>
                    <Badge variant="warning" className="gap-1">
                      <Lock size={9} />
                      {formatNumber(h.blocked_quantity)}
                    </Badge>
                  </span>
                )}
                {h.pending_quantity > 0 && (
                  <span
                    title={`${t.transactions.statuses.PENDING}: ${formatNumber(h.pending_quantity)}`}
                  >
                    <Badge variant="accent" className="gap-1">
                      <Clock size={9} />
                      {formatNumber(h.pending_quantity)}
                    </Badge>
                  </span>
                )}
              </span>
            )}
          </div>
        ),
      },
      {
        key: "fifo",
        header: "FIFO",
        align: "right",
        sortValue: (h) => h.fifo_price,
        exportValue: (h) => h.fifo_price,
        cell: (h) => (
          <span className="text-text-secondary">
            {formatCurrency(h.fifo_price ?? 0, h.valuation_currency || "EUR")}
          </span>
        ),
      },
      {
        key: "current",
        header: t.portfolio.colPrice,
        align: "right",
        sortValue: (h) => h.quote_mid_price,
        exportValue: (h) => h.quote_mid_price,
        cell: (h) => (
          <span className="inline-flex items-center justify-end gap-1.5">
            {h.quote_is_outdated && (
              <AlertTriangle size={12} className="text-warning" aria-label={t.security.quoteOutdated} />
            )}
            {formatCurrency(h.quote_mid_price ?? 0, h.quote_currency || "EUR")}
          </span>
        ),
      },
      {
        key: "valuation",
        header: t.portfolio.colValue,
        align: "right",
        sortValue: (h) => h.valuation,
        exportValue: (h) => h.valuation,
        cell: (h) => (
          <span className="font-medium text-text-primary">
            {formatCurrency(h.valuation ?? 0, h.valuation_currency || "EUR")}
          </span>
        ),
      },
      {
        key: "return",
        header: t.portfolio.colReturn,
        align: "right",
        sortValue: (h) => sinceBuy(h).pct,
        exportValue: (h) => sinceBuy(h).abs,
        cell: (h) => {
          const { abs, pct } = sinceBuy(h);
          const positive = abs >= 0;
          return (
            <div className={positive ? "text-positive" : "text-negative"}>
              <div className="font-medium">
                {positive ? "+" : ""}
                {formatCurrency(abs, h.valuation_currency || "EUR")}
              </div>
              <div className="text-2xs">{formatPercent(pct)}</div>
            </div>
          );
        },
      },
      {
        key: "share",
        header: t.rebalancing.actual,
        align: "right",
        hideNarrow: true,
        sortValue: (h) => (totalValuation > 0 ? (h.valuation / totalValuation) * 100 : 0),
        exportValue: (h) => (totalValuation > 0 ? (h.valuation / totalValuation) * 100 : 0),
        cell: (h) => (
          <span className="text-text-secondary">
            {totalValuation > 0 ? `${formatNumber((h.valuation / totalValuation) * 100)}%` : "—"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        cell: (h) => (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTrade("buy", h.isin);
              }}
              aria-label={t.security.buy}
              title={t.security.buy}
              className="cursor-pointer rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-positive/10 hover:text-positive"
            >
              <ShoppingCart size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTrade("sell", h.isin);
              }}
              aria-label={t.security.sell}
              title={t.security.sell}
              className="cursor-pointer rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-negative/10 hover:text-negative"
            >
              <TrendingDown size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddToWatchlist(h.isin);
              }}
              aria-label={t.watchlist.addSecurity}
              title={t.watchlist.addSecurity}
              className="cursor-pointer rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-accent-dim hover:text-accent"
            >
              <Star size={14} />
            </button>
          </div>
        ),
      },
    ];

    if (hasYTD) {
      cols.splice(cols.length - 1, 0, {
        key: "ytd",
        header: t.security.timeframes.ytd,
        align: "right",
        hideNarrow: true,
        sortValue: (h) => h.year_to_date_performance ?? 0,
        exportValue: (h) => (h.year_to_date_performance ?? 0) * 100,
        cell: (h) => {
          const v = (h.year_to_date_performance ?? 0) * 100;
          return <span className={v >= 0 ? "text-positive" : "text-negative"}>{formatPercent(v)}</span>;
        },
      });
    }

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, holdingsCount, totalValuation, hasYTD, t, onTrade, onAddToWatchlist]);
}
