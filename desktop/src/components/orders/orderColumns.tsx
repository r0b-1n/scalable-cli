import { useMemo } from "react";
import Badge from "../ui/Badge";
import { CopyButton } from "../ui/CliCommand";
import { formatCurrency, formatDateTime, formatNumber } from "../../lib/format";
import { enumLabel, type Translations } from "../../i18n";
import type { Column } from "../ui/DataTable";
import type { Transaction } from "../../api/types";

interface BuildOrderColumnsOptions {
  t: Translations;
  /** Only the Open tab gets a cancel action. */
  showCancel: boolean;
  onCancel: (tx: Transaction) => void;
}

function normalizedSide(tx: Transaction): "BUY" | "SELL" | null {
  const raw = (tx.side || tx.type || "").toUpperCase();
  return raw === "BUY" || raw === "SELL" ? raw : null;
}

function statusVariant(status: string): "default" | "positive" | "negative" | "warning" {
  const s = status.toUpperCase();
  if (s === "FILLED" || s === "SETTLED" || s === "CONFIRMED") return "positive";
  if (s === "CANCELLED" || s === "REJECTED" || s === "EXPIRED") return "negative";
  if (s === "PARTIAL_FILLED" || s === "CANCEL_REQUESTED" || s === "PENDING") return "warning";
  return "default";
}

/** Column set for the orders `DataTable` — open orders and history share it,
 * the cancel action column is only appended for the open tab. */
export function useOrderColumns({ t, showCancel, onCancel }: BuildOrderColumnsOptions): Column<Transaction>[] {
  return useMemo(() => {
    const cols: Column<Transaction>[] = [
      {
        key: "date",
        header: t.orders.placed,
        hideNarrow: true,
        sortValue: (tx) => new Date(tx.last_event_datetime).getTime() || 0,
        cell: (tx) => (
          <span className="whitespace-nowrap text-text-secondary">
            {tx.last_event_datetime ? formatDateTime(tx.last_event_datetime) : "—"}
          </span>
        ),
      },
      {
        key: "side",
        header: t.orders.side,
        sortValue: (tx) => normalizedSide(tx) ?? "",
        cell: (tx) => {
          const side = normalizedSide(tx);
          if (!side) return <Badge>{enumLabel(t.transactions.txTypes, tx.type)}</Badge>;
          return (
            <Badge variant={side === "BUY" ? "positive" : "negative"}>
              {side === "BUY" ? t.trade.sideBuy : t.trade.sideSell}
            </Badge>
          );
        },
      },
      {
        key: "security",
        header: t.trade.rowSecurity,
        sortValue: (tx) => tx.description || tx.isin || "",
        exportValue: (tx) => (tx.isin ? `${tx.description || tx.isin} (${tx.isin})` : tx.description || ""),
        cell: (tx) => (
          <div className="min-w-0">
            <p className="truncate text-sm text-text-primary">{tx.description || tx.isin || "—"}</p>
            {tx.isin && tx.description && <p className="text-2xs text-text-tertiary">{tx.isin}</p>}
          </div>
        ),
      },
      {
        key: "quantity",
        header: t.orders.quantity,
        align: "right",
        sortValue: (tx) => tx.quantity ?? null,
        cell: (tx) => (tx.quantity != null ? formatNumber(tx.quantity) : "—"),
      },
      {
        key: "amount",
        header: t.transactions.colAmount,
        align: "right",
        sortValue: (tx) => tx.amount ?? null,
        cell: (tx) => (
          <span className="font-medium">
            {tx.amount != null ? formatCurrency(tx.amount, tx.currency || "EUR") : "—"}
          </span>
        ),
      },
      {
        key: "status",
        header: t.transactions.colStatus,
        align: "right",
        sortValue: (tx) => tx.status,
        cell: (tx) => (
          <Badge variant={statusVariant(tx.status)}>{enumLabel(t.transactions.statuses, tx.status)}</Badge>
        ),
      },
      {
        key: "orderId",
        header: t.orders.orderId,
        hideNarrow: true,
        align: "right",
        sortValue: (tx) => tx.id,
        cell: (tx) => (
          <span className="inline-flex items-center gap-1">
            <span className="max-w-[9rem] truncate font-mono text-2xs text-text-tertiary">{tx.id}</span>
            <CopyButton value={tx.id} />
          </span>
        ),
      },
    ];

    if (showCancel) {
      cols.push({
        key: "actions",
        header: "",
        cell: (tx) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancel(tx);
            }}
            aria-label={`${t.orders.cancel} ${tx.id}`}
            className="cursor-pointer rounded-full bg-negative/10 px-2.5 py-1 text-2xs font-medium text-negative transition-colors hover:bg-negative/20"
          >
            {t.orders.cancel}
          </button>
        ),
      });
    }

    return cols;
  }, [t, showCancel, onCancel]);
}
