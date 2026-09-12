import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Badge from "../ui/Badge";
import EmptyState from "../ui/EmptyState";
import { Table, THead, TH, TR, TD } from "../ui/Table";
import { formatCurrency, formatDateTime, formatNumber } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import { ChevronLeft, ChevronRight, Search, ArrowLeftRight } from "lucide-react";

const TYPE_FILTER_VALUES = [
  "BUY",
  "SELL",
  "SAVINGS_PLAN",
  "DISTRIBUTION",
  "INTEREST",
  "FEE",
  "DEPOSIT",
  "WITHDRAWAL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
];

export default function Transactions() {
  const { activePortfolioId } = useAppStore();
  const { t } = useI18n();

  const typeFilterOptions = [
    { value: "", label: t.common.allTypes },
    ...TYPE_FILTER_VALUES.map((v) => ({ value: v, label: enumLabel(t.transactions.txTypes, v) })),
  ];

  const txLabel = (tx: any): string =>
    enumLabel(t.transactions.txTypes, tx.security_transaction_type || tx.side || tx.type);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const loadTransactions = async (pageCursor?: string) => {
    setLoading(true);
    try {
      const result = await api.getTransactions({
        portfolioId: activePortfolioId || undefined,
        pageSize: 25,
        cursor: pageCursor || undefined,
        typeFilter: typeFilter ? [typeFilter] : undefined,
        searchTerm: searchTerm || undefined,
      });
      // sc --json wraps the payload in {resolution, result: {items, cursor}}.
      const data = (result as any)?.result ?? {};
      setTransactions(data.items ?? []);
      setNextCursor(data.cursor ?? null);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [activePortfolioId, typeFilter, searchTerm]);

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

  const handleSearch = () => {
    setCursors([]);
    setCursor(null);
    setSearchTerm(searchInput);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t.transactions.title}</h1>
        <div className="flex items-center gap-2">
          <Select
            className="w-44"
            options={typeFilterOptions}
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setCursors([]);
              setCursor(null);
            }}
          />
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
            />
            <Input
              className="w-64 pl-9"
              placeholder={t.transactions.searchPlaceholder}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight size={20} />}
          title={t.transactions.emptyTitle}
          description={t.transactions.emptyDesc}
        />
      ) : (
        <Table>
          <THead>
            <TH>{t.transactions.colDate}</TH>
            <TH>{t.transactions.colType}</TH>
            <TH>{t.transactions.colDescription}</TH>
            <TH align="right">{t.transactions.colQuantity}</TH>
            <TH align="right">{t.transactions.colAmount}</TH>
            <TH align="right">{t.transactions.colStatus}</TH>
          </THead>
          <tbody>
            {transactions.map((tx: any) => (
              <TR key={tx.id}>
                <TD className="text-text-secondary whitespace-nowrap">
                  {tx.last_event_datetime ? formatDateTime(tx.last_event_datetime) : "—"}
                </TD>
                <TD>
                  <Badge>{txLabel(tx)}</Badge>
                </TD>
                <TD>
                  <p className="text-sm text-text-primary">{tx.description || "—"}</p>
                  {tx.isin && <p className="text-2xs text-text-tertiary">{tx.isin}</p>}
                </TD>
                <TD numeric className="text-text-secondary">
                  {tx.quantity != null ? formatNumber(tx.quantity) : "—"}
                </TD>
                <TD numeric className="font-medium">
                  {formatCurrency(tx.amount ?? 0, tx.currency || "EUR")}
                </TD>
                <TD numeric>
                  <Badge
                    variant={
                      tx.status === "FILLED" || tx.status === "SETTLED" || tx.status === "CONFIRMED"
                        ? "positive"
                        : tx.status === "CANCELLED" || tx.status === "REJECTED" || tx.status === "EXPIRED"
                          ? "negative"
                          : "default"
                    }
                  >
                    {enumLabel(t.transactions.statuses, tx.status)}
                  </Badge>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={handlePrev} disabled={cursors.length === 0}>
          <ChevronLeft size={15} className="mr-1" />
          {t.common.previous}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleNext} disabled={!nextCursor}>
          {t.common.next}
          <ChevronRight size={15} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}
