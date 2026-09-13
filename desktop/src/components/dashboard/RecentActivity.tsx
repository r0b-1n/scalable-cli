import { useNavigate } from "react-router-dom";
import { CardHeader, CardTitle } from "../ui/Card";
import EmptyState from "../ui/EmptyState";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import type { Transaction } from "../../api/types";
import { ArrowDownRight, ArrowUpRight, History } from "lucide-react";

/** Last few `getTransactions` rows, across every type — a recent-activity feed. */
export default function RecentActivity({ items }: { items: Transaction[] }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <section>
      <CardHeader>
        <CardTitle>{t.transactions.title}</CardTitle>
        <button
          onClick={() => navigate("/transactions")}
          className="cursor-pointer text-xs font-medium text-accent transition-colors hover:text-accent-hover"
        >
          {t.dashboard.viewAll}
        </button>
      </CardHeader>
      {items.length === 0 ? (
        <EmptyState
          icon={<History size={20} />}
          title={t.transactions.emptyTitle}
          description={t.transactions.emptyDesc}
        />
      ) : (
        <div className="divide-y divide-border">
          {items.map((tx) => {
            const amount = tx.amount ?? 0;
            const isCredit = amount >= 0;
            return (
              <button
                key={tx.id}
                onClick={() => navigate("/transactions")}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg py-3 text-left transition-colors hover:bg-hover"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      isCredit ? "bg-positive/10" : "bg-negative/10"
                    }`}
                  >
                    {isCredit ? (
                      <ArrowUpRight size={14} className="text-positive" aria-hidden="true" />
                    ) : (
                      <ArrowDownRight size={14} className="text-negative" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {tx.description || enumLabel(t.transactions.txTypes, tx.type)}
                    </p>
                    <p className="text-2xs text-text-tertiary">
                      {formatDateTime(tx.last_event_datetime)}
                    </p>
                  </div>
                </div>
                <span
                  className={`shrink-0 text-sm font-medium tabular-nums ${
                    isCredit ? "text-positive" : "text-negative"
                  }`}
                >
                  {amount === 0 ? "—" : `${isCredit ? "+" : "−"}${formatCurrency(Math.abs(amount), tx.currency || "EUR")}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
