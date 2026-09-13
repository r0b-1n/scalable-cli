import { useEffect, useState } from "react";
import { Briefcase } from "lucide-react";
import { api } from "../../api/client";
import { useI18n, enumLabel } from "../../i18n";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from "../../lib/format";
import { CardHeader, CardTitle } from "../ui/Card";
import Badge from "../ui/Badge";
import { Table, THead, TH, TR, TD } from "../ui/Table";
import { SkeletonLines } from "../ui/Skeleton";
import EmptyState from "../ui/EmptyState";
import CliCommand from "../ui/CliCommand";
import type { Holding, Transaction } from "../../api/types";

interface SecurityPositionProps {
  isin: string;
  portfolioId?: string;
}

/** since-buy P&L: absolute (position currency) and percent. */
function sinceBuy(h: Holding): { abs: number; pct: number } {
  const abs =
    h.fifo_price != null && h.quote_mid_price != null ? (h.quote_mid_price - h.fifo_price) * h.quantity : 0;
  const pct = h.fifo_price ? (h.quote_mid_price / h.fifo_price - 1) * 100 : 0;
  return { abs, pct };
}

/**
 * Your position in this security (from `get_holdings`, matched by ISIN) plus
 * the transactions that built it (`get_transactions --isin`).
 */
export default function SecurityPosition({ isin, portfolioId }: SecurityPositionProps) {
  const { t } = useI18n();
  const [holding, setHolding] = useState<Holding | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setHoldingsLoading(true);
    api
      .getHoldings({ portfolioId })
      .then((data) => {
        if (cancelled) return;
        setHolding(data.result.items.find((h) => h.isin === isin) ?? null);
      })
      .catch(() => {
        if (!cancelled) setHolding(null);
      })
      .finally(() => {
        if (!cancelled) setHoldingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isin, portfolioId]);

  useEffect(() => {
    let cancelled = false;
    setTxLoading(true);
    api
      .getTransactions({ portfolioId, isin, pageSize: 10 })
      .then((data) => {
        if (!cancelled) setTransactions(data.result.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setTransactions([]);
      })
      .finally(() => {
        if (!cancelled) setTxLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isin, portfolioId]);

  const pnl = holding ? sinceBuy(holding) : null;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <section>
        <CardHeader>
          <CardTitle>{t.portfolio.title}</CardTitle>
        </CardHeader>
        {holdingsLoading ? (
          <SkeletonLines rows={3} />
        ) : holding && pnl ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-text-secondary">{t.portfolio.colQuantity}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {formatNumber(holding.quantity)}
              </p>
              {(holding.blocked_quantity > 0 || holding.pending_quantity > 0) && (
                <p className="mt-0.5 text-2xs text-text-tertiary tabular-nums">
                  {holding.blocked_quantity > 0 &&
                    `${t.portfolio.blockedQuantity}: ${formatNumber(holding.blocked_quantity)}`}
                  {holding.blocked_quantity > 0 && holding.pending_quantity > 0 && " · "}
                  {holding.pending_quantity > 0 &&
                    `${t.portfolio.pendingQuantity}: ${formatNumber(holding.pending_quantity)}`}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-text-secondary">{t.portfolio.colFifoPrice}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {formatCurrency(holding.fifo_price ?? 0, holding.valuation_currency || "EUR")}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">{t.portfolio.colValue}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {formatCurrency(holding.valuation ?? 0, holding.valuation_currency || "EUR")}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">{t.portfolio.colReturn}</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${pnl.abs >= 0 ? "text-positive" : "text-negative"}`}>
                {pnl.abs >= 0 ? "+" : ""}
                {formatCurrency(pnl.abs, holding.valuation_currency || "EUR")}
                <span className="ml-1.5 text-xs font-medium">{formatPercent(pnl.pct)}</span>
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Briefcase size={18} />}
            title={t.portfolio.noHoldingsTitle}
            description={t.portfolio.noHoldingsDesc}
            className="py-8"
          />
        )}
        <CliCommand commands={renderCliCommand("get_holdings", { portfolioId })} className="mt-3" />
      </section>

      <section>
        <CardHeader>
          <CardTitle>{t.transactions.title}</CardTitle>
        </CardHeader>
        {txLoading ? (
          <SkeletonLines rows={3} />
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={<Briefcase size={18} />}
            title={t.transactions.emptyTitle}
            description={t.transactions.emptyDesc}
            className="py-8"
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <THead>
                <TH>{t.transactions.colDate}</TH>
                <TH>{t.transactions.colType}</TH>
                <TH align="right">{t.transactions.colQuantity}</TH>
                <TH align="right">{t.transactions.colAmount}</TH>
              </THead>
              <tbody>
                {transactions.map((tx) => (
                  <TR key={tx.id}>
                    <TD className="whitespace-nowrap text-text-secondary">
                      {tx.last_event_datetime ? formatDateTime(tx.last_event_datetime) : "—"}
                    </TD>
                    <TD>
                      <Badge>
                        {enumLabel(t.transactions.txTypes, tx.security_transaction_type || tx.side || tx.type)}
                      </Badge>
                    </TD>
                    <TD numeric className="text-text-secondary">
                      {tx.quantity != null ? formatNumber(tx.quantity) : "—"}
                    </TD>
                    <TD numeric className="font-medium">
                      {formatCurrency(tx.amount ?? 0, tx.currency || "EUR")}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <CliCommand
          commands={renderCliCommand("get_transactions", { portfolioId, isin, pageSize: 10 })}
          className="mt-3"
        />
      </section>
    </div>
  );
}
