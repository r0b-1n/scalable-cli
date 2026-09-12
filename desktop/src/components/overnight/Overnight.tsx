import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Select from "../ui/Select";
import Stat from "../ui/Stat";
import EmptyState from "../ui/EmptyState";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import { Moon, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight } from "lucide-react";

const TYPE_FILTER_VALUES = [
  "DEPOSIT",
  "WITHDRAWAL",
  "INTEREST",
  "CASH_TRANSFER_IN",
  "CASH_TRANSFER_OUT",
];

export default function Overnight() {
  const { t } = useI18n();
  const [data, setData] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = await api.getOvernight();
        // sc --json wraps the payload in {account, result: {...}}.
        setData((result as any)?.result ?? null);
      } catch {
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const loadTransactions = async (pageCursor?: string) => {
    setTxLoading(true);
    try {
      const result = await api.getOvernightTransactions({
        pageSize: 20,
        cursor: pageCursor || undefined,
        typeFilter: typeFilter ? [typeFilter] : undefined,
      });
      const txData = (result as any)?.result ?? {};
      setTransactions(txData.items ?? []);
      setNextCursor(txData.cursor ?? null);
    } catch {
    } finally {
      setTxLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [typeFilter]);

  const handleNext = () => {
    if (nextCursor) {
      setCursors((prev) => [...prev, cursor || ""]);
      setCursor(nextCursor);
      loadTransactions(nextCursor);
    }
  };

  const handlePrev = () => {
    if (cursors.length > 0) {
      const prevCursor = cursors[cursors.length - 1];
      setCursors((prev) => prev.slice(0, -1));
      setCursor(prevCursor || null);
      loadTransactions(prevCursor || undefined);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={32} />
      </div>
    );
  }

  const rate = data?.interest_rate ? parseFloat(data.interest_rate) * 100 : null;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t.overnight.title}</h1>

      {/* Hero */}
      <section className="pb-8 border-b border-border">
        <Stat
          size="hero"
          label={t.overnight.balance}
          value={formatCurrency(parseFloat(data?.balance || "0"))}
          delta={rate != null ? { text: `${formatNumber(rate)}% p.a.`, positive: true } : undefined}
          sub={
            data?.estimated_next_payout_amount
              ? t.overnight.nextPayout(
                  formatCurrency(parseFloat(data.estimated_next_payout_amount)),
                  data.next_payout_date ? formatDate(data.next_payout_date) : null
                )
              : undefined
          }
        />
      </section>

      {/* Accrual details */}
      <section className="grid grid-cols-2 divide-x divide-border pb-8 border-b border-border">
        <Stat
          size="lg"
          label={t.overnight.accruedPeriod}
          value={formatCurrency(parseFloat(data?.current_accrued_amount || "0"))}
        />
        <div className="pl-8">
          <Stat
            size="lg"
            label={t.overnight.lifetimeInterest}
            value={formatCurrency(parseFloat(data?.deposit_accrued_lifetime_amount || "0"))}
          />
        </div>
      </section>

      {/* Transactions */}
      <section>
        <CardHeader>
          <CardTitle>{t.overnight.transactions}</CardTitle>
          <Select
            options={[
              { value: "", label: t.common.allTypes },
              ...TYPE_FILTER_VALUES.map((v) => ({
                value: v,
                label: enumLabel(t.overnight.cashTxTypes, v),
              })),
            ]}
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setCursors([]);
              setCursor(null);
            }}
            className="w-40 h-8 text-xs"
          />
        </CardHeader>
        {txLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={24} />
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={<Moon size={20} />}
            title={t.overnight.emptyTitle}
            description={t.overnight.emptyDesc}
          />
        ) : (
          <div className="divide-y divide-border">
            {transactions.map((tx: any) => {
              const amount = parseFloat(tx.amount || "0");
              const isCredit = amount >= 0;
              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between px-2 -mx-2 py-3.5 rounded-lg hover:bg-bg-card-hover/60 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        isCredit ? "bg-positive/10" : "bg-negative/10"
                      }`}
                    >
                      {isCredit ? (
                        <ArrowUpRight size={14} className="text-positive" />
                      ) : (
                        <ArrowDownRight size={14} className="text-negative" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        {tx.description ||
                          enumLabel(
                            t.overnight.cashTxTypes,
                            tx.cash_transaction_type || tx.type,
                            t.overnight.fallbackTx
                          )}
                      </p>
                      <p className="text-2xs text-text-tertiary">
                        {tx.last_event_datetime ? formatDateTime(tx.last_event_datetime) : "—"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-sm font-medium tabular-nums ${
                      isCredit ? "text-positive" : "text-negative"
                    }`}
                  >
                    {isCredit ? "+" : "−"}
                    {formatCurrency(Math.abs(amount), tx.currency || "EUR")}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between pt-4">
          <Button variant="ghost" size="sm" onClick={handlePrev} disabled={cursors.length === 0}>
            <ChevronLeft size={15} className="mr-1" />
            {t.common.previous}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleNext} disabled={!nextCursor}>
            {t.common.next}
            <ChevronRight size={15} className="ml-1" />
          </Button>
        </div>
      </section>
    </div>
  );
}
