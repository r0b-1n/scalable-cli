import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import { CardHeader, CardTitle } from "../ui/Card";
import DataTable, { type Column } from "../ui/DataTable";
import EmptyState from "../ui/EmptyState";
import CliCommand from "../ui/CliCommand";
import Stat from "../ui/Stat";
import { SkeletonLines } from "../ui/Skeleton";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import type { OvernightAccount, OvernightTransaction } from "../../api/types";
import OvernightFilters, { type OvernightFiltersState } from "./OvernightFilters";
import InterestHistoryChart from "./InterestHistoryChart";

const DEFAULT_FILTERS: OvernightFiltersState = {
  types: [],
  search: "",
  from: "",
  to: "",
  pageSize: 25,
};

function isoStartOfDay(dateInput: string): string {
  return new Date(`${dateInput}T00:00:00.000Z`).toISOString();
}
function isoEndOfDay(dateInput: string): string {
  return new Date(`${dateInput}T23:59:59.999Z`).toISOString();
}

interface Summary {
  interest_rate: string;
  balance: string;
  current_interest_bearing_amount: string;
  current_accrued_amount: string;
  estimated_next_payout_amount: string;
  next_payout_date: string | null;
  deposit_accrued_lifetime_amount: string;
}

/**
 * `/overnight` — the account summary from `get_overnight`, a transaction
 * browser exposing the FULL `get_overnight_transactions` filter surface
 * (type, search term, from/to, page size, cursor pagination — the app
 * previously only exposed the type filter), a CSV export via `DataTable`,
 * and an interest-history chart reconstructed by month.
 */
export default function Overnight() {
  const { t } = useI18n();
  // `/overnight` is account-scoped, not portfolio-scoped (`get_overnight` and
  // `get_overnight_transactions` take no `--portfolio-id`), so only the
  // header's refresh action needs to re-trigger this screen.
  const refreshToken = useAppStore((s) => s.refreshToken);

  const [account, setAccount] = useState<OvernightAccount | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<OvernightFiltersState>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<OvernightFiltersState>(DEFAULT_FILTERS);

  const [items, setItems] = useState<OvernightTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);

  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getOvernight();
      setAccount(data.account ?? null);
      setSummary(data.result ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const buildTxParams = useCallback(
    (cursor: string | undefined) => ({
      pageSize: applied.pageSize,
      cursor,
      typeFilter: applied.types.length ? applied.types : undefined,
      searchTerm: applied.search || undefined,
      fromTime: applied.from ? isoStartOfDay(applied.from) : undefined,
      toTime: applied.to ? isoEndOfDay(applied.to) : undefined,
    }),
    [applied]
  );

  const loadTx = useCallback(
    async (cursor: string | undefined) => {
      setTxLoading(true);
      setTxError(null);
      try {
        const res = await api.getOvernightTransactions(buildTxParams(cursor));
        setItems(res.result.items ?? []);
        setTotal(res.result.total ?? 0);
        setNextCursor(res.result.cursor ?? null);
      } catch (err) {
        setTxError(err instanceof Error ? err.message : t.common.loadFailed);
      } finally {
        setTxLoading(false);
      }
    },
    [buildTxParams, t.common.loadFailed]
  );

  useEffect(() => {
    setCursorStack([]);
    setCurrentCursor(undefined);
    loadTx(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, loadTx, refreshToken]);

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, currentCursor]);
    setCurrentCursor(nextCursor);
    loadTx(nextCursor);
  };
  const handlePrev = () => {
    if (cursorStack.length === 0) return;
    const popped = cursorStack[cursorStack.length - 1];
    setCursorStack(cursorStack.slice(0, -1));
    setCurrentCursor(popped);
    loadTx(popped);
  };
  const handleApply = () => setApplied(draft);
  const handleReset = () => {
    setDraft(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
  };

  const columns: Column<OvernightTransaction>[] = [
    {
      key: "date",
      header: t.transactions.colDate,
      cell: (tx) => (
        <span className="whitespace-nowrap text-text-secondary">
          {tx.last_event_datetime ? formatDateTime(tx.last_event_datetime) : "—"}
        </span>
      ),
      sortValue: (tx) => (tx.last_event_datetime ? new Date(tx.last_event_datetime).getTime() : 0),
      exportValue: (tx) => tx.last_event_datetime ?? "",
    },
    {
      key: "description",
      header: t.transactions.colDescription,
      cell: (tx) => (
        <p className="text-sm text-text-primary">
          {tx.description || enumLabel(t.overnight.cashTxTypes, tx.cash_transaction_type || tx.type, t.overnight.fallbackTx)}
        </p>
      ),
      sortValue: (tx) => tx.description ?? "",
    },
    {
      key: "type",
      header: t.transactions.colType,
      cell: (tx) => <Badge>{enumLabel(t.overnight.cashTxTypes, tx.cash_transaction_type || tx.type)}</Badge>,
      sortValue: (tx) => tx.type ?? "",
    },
    {
      key: "amount",
      header: t.transactions.colAmount,
      align: "right",
      cell: (tx) => {
        const amount = parseFloat(tx.amount || "0");
        const isCredit = amount >= 0;
        return (
          <span className={`font-medium ${isCredit ? "text-positive" : "text-negative"}`}>
            {isCredit ? <ArrowUpRight size={12} className="mr-1 inline" /> : <ArrowDownRight size={12} className="mr-1 inline" />}
            {formatCurrency(Math.abs(amount), tx.currency || "EUR")}
          </span>
        );
      },
      sortValue: (tx) => parseFloat(tx.amount || "0"),
      exportValue: (tx) => tx.amount,
    },
    {
      key: "status",
      header: t.transactions.colStatus,
      align: "right",
      hideNarrow: true,
      cell: (tx) => <Badge variant="default">{enumLabel(t.transactions.statuses, tx.status)}</Badge>,
      sortValue: (tx) => tx.status ?? "",
    },
  ];

  const rate = summary?.interest_rate ? parseFloat(summary.interest_rate) * 100 : null;
  const offset = cursorStack.length * applied.pageSize;
  const shown = Math.min(offset + items.length, total);
  const cliSummary = renderCliCommand("get_overnight", {});
  const cliTx = renderCliCommand("get_overnight_transactions", buildTxParams(currentCursor));

  if (error && !loading && !summary) {
    return (
      <div className="space-y-8">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.overnight.title}</h1>
        <div className="space-y-4 py-16 text-center">
          <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{error}</p>
          <Button variant="secondary" onClick={load}>
            {t.common.retry}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.overnight.title}</h1>
          {account && (
            <p className="mt-1 flex items-center gap-2 text-sm text-text-secondary">
              {account.display_name} · {enumLabel(t.overnight.ownerKinds, account.owner_kind)}
              <Badge variant={account.is_active ? "positive" : "default"}>
                {account.is_active ? t.alerts.active : t.alerts.inactive}
              </Badge>
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <SkeletonLines rows={3} />
      ) : (
        summary && (
          <>
            <section className="border-b border-border pb-8">
              <Stat
                size="hero"
                label={t.overnight.balance}
                value={formatCurrency(parseFloat(summary.balance || "0"))}
                delta={rate != null ? { text: `${formatNumber(rate)}% p.a.`, positive: true } : undefined}
                sub={
                  summary.estimated_next_payout_amount
                    ? t.overnight.nextPayout(
                        formatCurrency(parseFloat(summary.estimated_next_payout_amount)),
                        summary.next_payout_date ? formatDate(summary.next_payout_date) : null
                      )
                    : undefined
                }
              />
            </section>

            <section className="grid grid-cols-2 gap-6 border-b border-border pb-8 sm:grid-cols-4">
              <Stat
                label="--current-interest-bearing-amount"
                value={formatCurrency(parseFloat(summary.current_interest_bearing_amount || "0"))}
              />
              <Stat label={t.overnight.accruedPeriod} value={formatCurrency(parseFloat(summary.current_accrued_amount || "0"))} />
              <Stat label={t.overnight.lifetimeInterest} value={formatCurrency(parseFloat(summary.deposit_accrued_lifetime_amount || "0"))} />
              <Stat
                label="--estimated-next-payout-amount"
                value={formatCurrency(parseFloat(summary.estimated_next_payout_amount || "0"))}
                sub={summary.next_payout_date ? formatDate(summary.next_payout_date) : undefined}
              />
            </section>
          </>
        )
      )}

      <InterestHistoryChart />

      <section className="space-y-4">
        <CardHeader>
          <CardTitle>{t.overnight.transactions}</CardTitle>
        </CardHeader>

        <OvernightFilters draft={draft} onChange={setDraft} onApply={handleApply} onReset={handleReset} />

        {txError && items.length === 0 && !txLoading ? (
          <div className="space-y-4 py-12 text-center">
            <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{txError}</p>
            <Button variant="secondary" onClick={() => loadTx(currentCursor)}>
              {t.common.retry}
            </Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(tx) => tx.id}
            loading={txLoading}
            exportName="overnight-transactions"
            initialSort={{ key: "date", direction: "desc" }}
            empty={<EmptyState icon={<Moon size={20} />} title={t.overnight.emptyTitle} description={t.overnight.emptyDesc} />}
          />
        )}

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" onClick={handlePrev} disabled={cursorStack.length === 0 || txLoading}>
            <ChevronLeft size={15} className="mr-1" />
            {t.common.previous}
          </Button>
          <span className="text-xs text-text-tertiary tabular-nums">
            {formatNumber(shown, 0)} {t.common.of} {formatNumber(total, 0)}
          </span>
          <Button variant="ghost" size="sm" onClick={handleNext} disabled={!nextCursor || txLoading}>
            {t.common.next}
            <ChevronRight size={15} className="ml-1" />
          </Button>
        </div>

        <CliCommand commands={[cliSummary, cliTx]} variant="block" />
      </section>
    </div>
  );
}
