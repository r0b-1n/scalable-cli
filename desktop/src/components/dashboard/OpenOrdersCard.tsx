import { useNavigate } from "react-router-dom";
import { CardHeader, CardTitle } from "../ui/Card";
import Badge from "../ui/Badge";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import type { Transaction } from "../../api/types";

function statusVariant(status: string): "default" | "accent" | "warning" {
  const s = status.toUpperCase();
  if (s === "PARTIAL_FILLED") return "accent";
  if (s === "CANCEL_REQUESTED") return "warning";
  return "default";
}

/**
 * Orders still working (`getTransactions` filtered to the open statuses).
 * Hidden entirely when there are none — an open-orders card with nothing to
 * show is noise, not information.
 */
export default function OpenOrdersCard({ orders }: { orders: Transaction[] }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  if (orders.length === 0) return null;

  return (
    <section>
      <CardHeader>
        <CardTitle>{t.orders.title}</CardTitle>
        <button
          onClick={() => navigate("/orders")}
          className="cursor-pointer text-xs font-medium text-accent transition-colors hover:text-accent-hover"
        >
          {t.dashboard.viewAll}
        </button>
      </CardHeader>
      <div className="divide-y divide-border">
        {orders.slice(0, 5).map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">
                {o.description || o.isin || enumLabel(t.transactions.txTypes, o.type)}
              </p>
              <p className="text-2xs text-text-tertiary">{formatDateTime(o.last_event_datetime)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {o.amount != null && (
                <span className="text-sm font-medium tabular-nums text-text-primary">
                  {formatCurrency(o.amount, o.currency || "EUR")}
                </span>
              )}
              <Badge variant={statusVariant(o.status)}>
                {enumLabel(t.transactions.statuses, o.status)}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
