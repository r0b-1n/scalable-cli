import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import DataTable, { type Column } from "../ui/DataTable";
import EmptyState from "../ui/EmptyState";
import CliCommand from "../ui/CliCommand";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency, formatDateTime, formatNumber } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import type { Transaction, TransactionStatus } from "../../api/types";
import TransactionFilters, { type TransactionFiltersState } from "./TransactionFilters";
import TransactionDetailModal from "./TransactionDetailModal";

const DEFAULT_FILTERS: TransactionFiltersState = {
  types: [],
  statuses: [],
  search: "",
  isin: "",
  from: "",
  to: "",
  includeReinvestmentSubtypes: false,
  pageSize: 25,
};

function isoStartOfDay(dateInput: string): string {
  return new Date(`${dateInput}T00:00:00.000Z`).toISOString();
}
function isoEndOfDay(dateInput: string): string {
  return new Date(`${dateInput}T23:59:59.999Z`).toISOString();
}

const POSITIVE_STATUSES = new Set<TransactionStatus>(["FILLED", "SETTLED", "CONFIRMED"]);
const NEGATIVE_STATUSES = new Set<TransactionStatus>(["CANCELLED", "REJECTED", "EXPIRED"]);

function statusVariant(status: string): "positive" | "negative" | "default" {
  if (POSITIVE_STATUSES.has(status as TransactionStatus)) return "positive";
  if (NEGATIVE_STATUSES.has(status as TransactionStatus)) return "negative";
  return "default";
}

/**
 * Full transaction browser: every filter `sc broker transactions` accepts,
 * cursor pagination (with a kept stack so "previous" actually goes back
 * rather than restarting), CSV export, and a row-click drawer into
 * `get_transaction_detail`.
 */
export default function Transactions() {
  const { activePortfolioId, refreshToken } = useAppStore();
  const { t } = useI18n();

  const [draft, setDraft] = useState<TransactionFiltersState>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<TransactionFiltersState>(DEFAULT_FILTERS);

  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [detailTx, setDetailTx] = useState<Transaction | null>(null);

  const buildParams = useCallback(
    (cursor: string | undefined) => ({
      portfolioId: activePortfolioId || undefined,
      pageSize: applied.pageSize,
      cursor,
      typeFilter: applied.types.length ? applied.types : undefined,
      status: applied.statuses.length ? applied.statuses : undefined,
      searchTerm: applied.search || undefined,
      isin: applied.isin || undefined,
      fromTime: applied.from ? isoStartOfDay(applied.from) : undefined,
      toTime: applied.to ? isoEndOfDay(applied.to) : undefined,
      includeReinvestmentSubtypes: applied.includeReinvestmentSubtypes || undefined,
    }),
    [activePortfolioId, applied]
  );

  const load = useCallback(
    async (cursor: string | undefined) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.getTransactions(buildParams(cursor));
        const data = res.result;
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setNextCursor(data.cursor ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.loadFailed);
      } finally {
        setLoading(false);
      }
    },
    [buildParams, t.common.loadFailed]
  );

  useEffect(() => {
    setCursorStack([]);
    setCurrentCursor(undefined);
    load(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortfolioId, refreshToken, applied, load]);

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, currentCursor]);
    setCurrentCursor(nextCursor);
    load(nextCursor);
  };

  const handlePrev = () => {
    if (cursorStack.length === 0) return;
    const popped = cursorStack[cursorStack.length - 1];
    setCursorStack(cursorStack.slice(0, -1));
    setCurrentCursor(popped);
    load(popped);
  };

  const handleApply = () => setApplied(draft);
  const handleReset = () => {
    setDraft(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
  };

  const columns: Column<Transaction>[] = [
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
      key: "type",
      header: t.transactions.colType,
      cell: (tx) => <Badge>{enumLabel(t.transactions.txTypes, tx.type)}</Badge>,
      sortValue: (tx) => tx.type ?? "",
      exportValue: (tx) => tx.type ?? "",
    },
    {
      key: "description",
      header: t.transactions.colDescription,
      cell: (tx) => (
        <div>
          <p className="text-sm text-text-primary">{tx.description || "—"}</p>
          {tx.isin && <p className="text-2xs text-text-tertiary">{tx.isin}</p>}
        </div>
      ),
      sortValue: (tx) => tx.description ?? "",
    },
    {
      key: "quantity",
      header: t.transactions.colQuantity,
      align: "right",
      hideNarrow: true,
      cell: (tx) => (tx.quantity != null ? formatNumber(tx.quantity) : "—"),
      sortValue: (tx) => tx.quantity ?? null,
    },
    {
      key: "amount",
      header: t.transactions.colAmount,
      align: "right",
      cell: (tx) => (
        <span className="font-medium">{formatCurrency(tx.amount ?? 0, tx.currency || "EUR")}</span>
      ),
      sortValue: (tx) => tx.amount ?? 0,
      exportValue: (tx) => tx.amount ?? 0,
    },
    {
      key: "status",
      header: t.transactions.colStatus,
      align: "right",
      cell: (tx) => <Badge variant={statusVariant(tx.status)}>{enumLabel(t.transactions.statuses, tx.status)}</Badge>,
      sortValue: (tx) => tx.status ?? "",
      exportValue: (tx) => tx.status ?? "",
    },
  ];

  const offset = cursorStack.length * applied.pageSize;
  const shown = Math.min(offset + items.length, total);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.transactions.title}</h1>

      <TransactionFilters draft={draft} onChange={setDraft} onApply={handleApply} onReset={handleReset} />

      {error && items.length === 0 && !loading ? (
        <div className="space-y-4 py-16 text-center">
          <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{error}</p>
          <Button variant="secondary" onClick={() => load(currentCursor)}>
            {t.common.retry}
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(tx) => tx.id}
          onRowClick={(tx) => setDetailTx(tx)}
          loading={loading}
          exportName="transactions"
          initialSort={{ key: "date", direction: "desc" }}
          empty={
            <EmptyState
              icon={<ArrowLeftRight size={20} />}
              title={t.transactions.emptyTitle}
              description={t.transactions.emptyDesc}
            />
          }
        />
      )}

      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" size="sm" onClick={handlePrev} disabled={cursorStack.length === 0 || loading}>
          <ChevronLeft size={15} className="mr-1" />
          {t.common.previous}
        </Button>
        <span className="text-xs text-text-tertiary tabular-nums">
          {formatNumber(shown, 0)} {t.common.of} {formatNumber(total, 0)}
        </span>
        <Button variant="ghost" size="sm" onClick={handleNext} disabled={!nextCursor || loading}>
          {t.common.next}
          <ChevronRight size={15} className="ml-1" />
        </Button>
      </div>

      <CliCommand commands={renderCliCommand("get_transactions", buildParams(currentCursor))} variant="block" />

      <TransactionDetailModal
        transaction={detailTx}
        portfolioId={activePortfolioId || undefined}
        onClose={() => setDetailTx(null)}
      />
    </div>
  );
}
