import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarClock } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Card from "../ui/Card";
import CliCommand from "../ui/CliCommand";
import DataTable, { type Column } from "../ui/DataTable";
import EmptyState from "../ui/EmptyState";
import Spinner from "../ui/Spinner";
import Stat from "../ui/Stat";
import { renderCliCommand } from "../../lib/cliLog";
import { chartTheme } from "../../lib/chartTheme";
import { formatCurrency, formatNumber } from "../../lib/format";
import { useI18n } from "../../i18n";
import { fetchAllOvernightTransactions, fetchAllTransactions, monthKeyOf, toNumber, yearOf } from "./reportUtils";

const PAGE_SIZE = 100;
// A synthetic grouping key for the by-security table: interest has no ISIN,
// so it is shown as its own row instead of being dropped.
const INTEREST_KEY = "__INTEREST__";

interface IncomeEvent {
  id: string;
  date: string;
  amount: number;
  currency: string;
  kind: "dividend" | "interest";
  isin: string | null;
}

interface SecurityRow {
  key: string;
  count: number;
  total: number;
  currency: string;
}

function buildMonthly(events: IncomeEvent[]) {
  const map = new Map<string, { dividends: number; interest: number }>();
  for (const e of events) {
    const key = monthKeyOf(e.date);
    const bucket = map.get(key) ?? { dividends: 0, interest: 0 };
    if (e.kind === "dividend") bucket.dividends += e.amount;
    else bucket.interest += e.amount;
    map.set(key, bucket);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, ...v }));
}

function buildYearly(events: IncomeEvent[]) {
  const map = new Map<string, { dividends: number; interest: number }>();
  for (const e of events) {
    const key = yearOf(e.date);
    const bucket = map.get(key) ?? { dividends: 0, interest: 0 };
    if (e.kind === "dividend") bucket.dividends += e.amount;
    else bucket.interest += e.amount;
    map.set(key, bucket);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, v]) => ({ year, ...v, total: v.dividends + v.interest }));
}

function buildBySecurity(events: IncomeEvent[]): SecurityRow[] {
  const map = new Map<string, SecurityRow>();
  for (const e of events) {
    const key = e.isin || INTEREST_KEY;
    const row = map.get(key) ?? { key, count: 0, total: 0, currency: e.currency };
    row.count += 1;
    row.total += e.amount;
    row.currency = e.currency;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/**
 * Composite income calendar: there is no single `sc` command for "income" —
 * this merges security distributions (`get_transactions`, including
 * reinvestment subtypes) with overnight interest (`get_overnight_transactions`)
 * into one dividends-vs-interest view, paging both endpoints to exhaustion.
 */
export default function IncomeReport() {
  const { activePortfolioId, refreshToken } = useAppStore();
  const { t } = useI18n();

  const [events, setEvents] = useState<IncomeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [txParams, setTxParams] = useState<Record<string, unknown>>({});
  const [ovParams, setOvParams] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadedCount(0);
    const portfolioId = activePortfolioId || undefined;
    const tParams = {
      portfolioId,
      typeFilter: ["DISTRIBUTION", "REINVESTMENT_DISTRIBUTION"],
      includeReinvestmentSubtypes: true,
    };
    const oParams = { typeFilter: ["INTEREST"] };
    setTxParams(tParams);
    setOvParams(oParams);
    try {
      const txItems = await fetchAllTransactions(tParams, PAGE_SIZE, (p) => setLoadedCount(p.loaded));
      const dividendEvents: IncomeEvent[] = txItems.map((tx) => ({
        id: tx.id,
        date: tx.last_event_datetime,
        amount: tx.amount ?? 0,
        currency: tx.currency || "EUR",
        kind: "dividend" as const,
        isin: tx.isin ?? null,
      }));

      const base = txItems.length;
      const ovItems = await fetchAllOvernightTransactions(oParams, PAGE_SIZE, (p) =>
        setLoadedCount(base + p.loaded)
      );
      const interestEvents: IncomeEvent[] = ovItems.map((tx) => ({
        id: tx.id,
        date: tx.last_event_datetime,
        amount: toNumber(tx.amount),
        currency: tx.currency || "EUR",
        kind: "interest" as const,
        isin: null,
      }));

      setEvents([...dividendEvents, ...interestEvents]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [activePortfolioId, t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const monthly = useMemo(() => buildMonthly(events), [events]);
  const yearly = useMemo(() => buildYearly(events), [events]);
  const bySecurity = useMemo(() => buildBySecurity(events), [events]);
  const totals = useMemo(
    () =>
      events.reduce(
        (acc, e) => {
          if (e.kind === "dividend") acc.dividends += e.amount;
          else acc.interest += e.amount;
          return acc;
        },
        { dividends: 0, interest: 0 }
      ),
    [events]
  );

  const theme = chartTheme();

  const securityColumns: Column<SecurityRow>[] = [
    {
      key: "security",
      header: t.reports.perSecurity,
      cell: (r) => (r.key === INTEREST_KEY ? t.overnight.title : r.key),
      sortValue: (r) => (r.key === INTEREST_KEY ? t.overnight.title : r.key),
      exportValue: (r) => (r.key === INTEREST_KEY ? t.overnight.title : r.key),
    },
    {
      key: "count",
      header: t.transactions.colQuantity,
      align: "right",
      cell: (r) => formatNumber(r.count, 0),
      sortValue: (r) => r.count,
    },
    {
      key: "total",
      header: t.reports.total,
      align: "right",
      cell: (r) => <span className="font-medium">{formatCurrency(r.total, r.currency)}</span>,
      sortValue: (r) => r.total,
      exportValue: (r) => r.total,
    },
  ];

  const yearColumns: Column<{ year: string; dividends: number; interest: number; total: number }>[] = [
    { key: "year", header: t.reports.year, cell: (r) => r.year, sortValue: (r) => r.year },
    {
      key: "dividends",
      header: t.reports.dividends,
      align: "right",
      cell: (r) => formatCurrency(r.dividends),
      sortValue: (r) => r.dividends,
    },
    {
      key: "interest",
      header: t.reports.interest,
      align: "right",
      cell: (r) => formatCurrency(r.interest),
      sortValue: (r) => r.interest,
    },
    {
      key: "total",
      header: t.reports.total,
      align: "right",
      cell: (r) => <span className="font-medium">{formatCurrency(r.total)}</span>,
      sortValue: (r) => r.total,
    },
  ];

  const cliCommands = [
    renderCliCommand("get_transactions", txParams),
    renderCliCommand("get_overnight_transactions", ovParams),
  ];

  if (error && events.length === 0 && !loading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.reports.income}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t.reports.incomeSubtitle}</p>
        </div>
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
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.reports.income}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t.reports.incomeSubtitle}</p>
        </div>
        <Badge variant="accent">{t.common.derived}</Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-20 text-sm text-text-secondary">
          <Spinner size={20} />
          <span className="tabular-nums">
            {t.reports.loadingAll} {loadedCount > 0 && `· ${formatNumber(loadedCount, 0)}`}
          </span>
        </div>
      ) : events.length === 0 ? (
        <EmptyState icon={<CalendarClock size={20} />} title={t.reports.noData} description={t.reports.derivedHint} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <Stat label={t.reports.dividends} value={formatCurrency(totals.dividends)} />
            </Card>
            <Card>
              <Stat label={t.reports.interest} value={formatCurrency(totals.interest)} />
            </Card>
            <Card>
              <Stat label={t.reports.netIncome} value={formatCurrency(totals.dividends + totals.interest)} />
            </Card>
          </div>

          <Card>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke={theme.grid} vertical={false} />
                  <XAxis dataKey="month" tick={theme.axisTick} tickLine={false} axisLine={{ stroke: theme.grid }} />
                  <YAxis
                    tick={theme.axisTick}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v: number) => formatCurrency(v)}
                  />
                  <Tooltip
                    contentStyle={theme.tooltip}
                    labelStyle={theme.tooltipLabel}
                    cursor={theme.cursor}
                    formatter={(value: number) => formatCurrency(value)}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: theme.axisTick.fill }} />
                  <Bar dataKey="dividends" name={t.reports.dividends} fill={theme.series[0]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="interest" name={t.reports.interest} fill={theme.series[1]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <DataTable
            columns={yearColumns}
            rows={yearly}
            rowKey={(r) => r.year}
            initialSort={{ key: "year", direction: "desc" }}
          />

          <DataTable
            columns={securityColumns}
            rows={bySecurity}
            rowKey={(r) => r.key}
            exportName="income-by-security"
            initialSort={{ key: "total", direction: "desc" }}
          />

          <p className="text-xs text-text-tertiary">{t.reports.derivedHint}</p>
        </>
      )}

      <CliCommand commands={cliCommands} variant="block" />
    </div>
  );
}
