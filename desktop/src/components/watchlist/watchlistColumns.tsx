import { useMemo } from "react";
import { AlertTriangle, Bell, ShoppingCart, Trash2 } from "lucide-react";
import Badge from "../ui/Badge";
import { formatCurrency, formatPercent } from "../../lib/format";
import { enumLabel, type Translations } from "../../i18n";
import type { Column } from "../ui/DataTable";
import type { SecuritySummary } from "../../api/types";

/** `sc broker watchlist --include-year-to-date` adds this field, mirroring
 * the same extra key `get_holdings` returns — not modelled on
 * `SecuritySummary` itself since it's only present behind that flag. */
export type WatchlistRow = SecuritySummary & { year_to_date_performance?: number | null };

interface BuildColumnsOptions {
  t: Translations;
  hasYTD: boolean;
  onBuy: (isin: string) => void;
  onAlert: (row: WatchlistRow) => void;
  onRemove: (row: WatchlistRow) => void;
}

/**
 * Column set for the watchlist `DataTable`. Kept out of Watchlist.tsx purely
 * to keep that file's line count manageable — nothing here is reusable
 * elsewhere.
 */
export function useWatchlistColumns(opts: BuildColumnsOptions): Column<WatchlistRow>[] {
  const { t, hasYTD, onBuy, onAlert, onRemove } = opts;

  return useMemo(() => {
    const cols: Column<WatchlistRow>[] = [
      {
        key: "security",
        header: t.portfolio.colSecurity,
        sortValue: (r) => r.name || r.isin,
        exportValue: (r) => `${r.name || r.isin} (${r.isin})`,
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-inset text-xs font-semibold text-text-tertiary">
              {(r.name || r.isin || "?").charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">{r.name || r.isin}</p>
              <p className="text-2xs text-text-tertiary">{r.isin}</p>
            </div>
          </div>
        ),
      },
      {
        key: "type",
        header: t.transactions.colType,
        hideNarrow: true,
        sortValue: (r) => r.security_type,
        exportValue: (r) => enumLabel(t.common.securityTypes, r.security_type),
        cell: (r) => <Badge>{enumLabel(t.common.securityTypes, r.security_type)}</Badge>,
      },
      {
        key: "price",
        header: t.portfolio.colPrice,
        align: "right",
        sortValue: (r) => r.quote_mid_price,
        exportValue: (r) => r.quote_mid_price,
        cell: (r) => (
          <span className="inline-flex items-center justify-end gap-1.5">
            {r.quote_is_outdated && (
              <AlertTriangle size={12} className="text-warning" aria-label={t.security.quoteOutdated} />
            )}
            {r.quote_mid_price != null ? formatCurrency(r.quote_mid_price, r.quote_currency || "EUR") : "—"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        cell: (r) => (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAlert(r);
              }}
              aria-label={t.watchlist.alertFromPrice}
              title={t.watchlist.alertFromPrice}
              className="cursor-pointer rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-accent-dim hover:text-accent"
            >
              <Bell size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBuy(r.isin);
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
                onRemove(r);
              }}
              aria-label={t.watchlist.removeAria(r.isin)}
              title={t.watchlist.removeAria(r.isin)}
              className="cursor-pointer rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-negative/10 hover:text-negative"
            >
              <Trash2 size={14} />
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
        sortValue: (r) => r.year_to_date_performance ?? 0,
        exportValue: (r) => (r.year_to_date_performance ?? 0) * 100,
        cell: (r) => {
          const v = (r.year_to_date_performance ?? 0) * 100;
          return <span className={v >= 0 ? "text-positive" : "text-negative"}>{formatPercent(v)}</span>;
        },
      });
    }

    return cols;
  }, [t, hasYTD, onBuy, onAlert, onRemove]);
}
