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
import { AlertTriangle, Receipt } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Card, { CardTitle } from "../ui/Card";
import CliCommand from "../ui/CliCommand";
import DataTable, { type Column } from "../ui/DataTable";
import EmptyState from "../ui/EmptyState";
import Input from "../ui/Input";
import Spinner from "../ui/Spinner";
import Stat from "../ui/Stat";
import { renderCliCommand } from "../../lib/cliLog";
import { chartTheme } from "../../lib/chartTheme";
import { formatCurrency, formatNumber } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import {
  MAX_ENRICH,
  buildCostTxParams,
  defaultCostRange,
  runCostReport,
  type TypeBucket,
  type YearBucket,
} from "./costAggregation";

/**
 * Composite tax & cost report: `get_transactions` list rows never carry a
 * fee/tax breakdown, so FEE/TAX/TAX_RETURN cash entries are aggregated
 * directly (see costAggregation.ts) while BUY/SELL rows are enriched via
 * `get_transaction_detail` with bounded concurrency and a capped row count —
 * both shown here rather than silently truncated.
 */
export default function CostReport() {
  const { activePortfolioId, refreshToken } = useAppStore();
  const { t } = useI18n();

  const initial = defaultCostRange();
  const [fromDraft, setFromDraft] = useState(initial.from);
  const [toDraft, setToDraft] = useState(initial.to);
  const [applied, setApplied] = useState(initial);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagedCount, setPagedCount] = useState(0);
  const [enrichDone, setEnrichDone] = useState(0);
  const [enrichTotal, setEnrichTotal] = useState(0);
  const [tradeRowCount, setTradeRowCount] = useState(0);

  const [yearBuckets, setYearBuckets] = useState<YearBucket[]>([]);
  const [typeBuckets, setTypeBuckets] = useState<TypeBucket[]>([]);
  const [hasData, setHasData] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPagedCount(0);
    setEnrichDone(0);
    setEnrichTotal(0);
    setTradeRowCount(0);
    setHasData(false);

    const portfolioId = activePortfolioId || undefined;
    try {
      const result = await runCostReport(portfolioId, applied.from, applied.to, (p) => {
        setPagedCount(p.paged);
        setEnrichDone(p.enrichedDone);
        setEnrichTotal(p.enrichedTotal);
      });
      setYearBuckets(result.yearBuckets);
      setTypeBuckets(result.typeBuckets);
      setTradeRowCount(result.tradeRowCount);
      setHasData(result.hasData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [activePortfolioId, applied, t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const totals = useMemo(
    () =>
      yearBuckets.reduce(
        (acc, y) => ({ fees: acc.fees + y.fees, taxes: acc.taxes + y.taxes }),
        { fees: 0, taxes: 0 }
      ),
    [yearBuckets]
  );

  const theme = chartTheme();
  const capped = tradeRowCount > MAX_ENRICH;
  const portfolioId = activePortfolioId || undefined;
  const txParams = buildCostTxParams(portfolioId, applied.from, applied.to);

  const yearColumns: Column<YearBucket>[] = [
    { key: "year", header: t.reports.year, cell: (r) => r.year, sortValue: (r) => r.year },
    {
      key: "fees",
      header: t.reports.fees,
      align: "right",
      cell: (r) => formatCurrency(r.fees),
      sortValue: (r) => r.fees,
    },
    {
      key: "taxes",
      header: t.reports.taxes,
      align: "right",
      cell: (r) => formatCurrency(r.taxes),
      sortValue: (r) => r.taxes,
    },
    {
      key: "total",
      header: t.reports.total,
      align: "right",
      cell: (r) => <span className="font-medium">{formatCurrency(r.total)}</span>,
      sortValue: (r) => r.total,
    },
  ];

  const typeColumns: Column<TypeBucket>[] = [
    {
      key: "type",
      header: t.transactions.colType,
      cell: (r) => enumLabel(t.transactions.txTypes, r.type),
      sortValue: (r) => r.type,
    },
    {
      key: "count",
      header: t.transactions.colQuantity,
      align: "right",
      cell: (r) => formatNumber(r.count, 0),
      sortValue: (r) => r.count,
    },
    {
      key: "fees",
      header: t.reports.fees,
      align: "right",
      cell: (r) => formatCurrency(r.fees),
      sortValue: (r) => r.fees,
    },
    {
      key: "taxes",
      header: t.reports.taxes,
      align: "right",
      cell: (r) => formatCurrency(r.taxes),
      sortValue: (r) => r.taxes,
    },
  ];

  const cliCommands = [
    renderCliCommand("get_transactions", txParams),
    renderCliCommand("get_transaction_detail", { transactionId: "<transaction-id>", portfolioId }),
  ];

  const applyRange = () => setApplied({ from: fromDraft, to: toDraft });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.reports.costs}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t.reports.costsSubtitle}</p>
        </div>
        <Badge variant="accent">{t.common.derived}</Badge>
      </div>

      <Card className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <span className="block font-mono text-2xs text-text-tertiary">--from-time</span>
          <Input
            type="date"
            value={fromDraft}
            max={toDraft}
            onChange={(e) => setFromDraft(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1.5">
          <span className="block font-mono text-2xs text-text-tertiary">--to-time</span>
          <Input
            type="date"
            value={toDraft}
            min={fromDraft}
            onChange={(e) => setToDraft(e.target.value)}
            className="w-40"
          />
        </div>
        <Button onClick={applyRange} disabled={loading}>
          {t.common.apply}
        </Button>
      </Card>

      {error && !loading ? (
        <div className="space-y-4 py-16 text-center">
          <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{error}</p>
          <Button variant="secondary" onClick={load}>
            {t.common.retry}
          </Button>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-sm text-text-secondary">
          <div className="flex items-center gap-3">
            <Spinner size={20} />
            <span className="tabular-nums">
              {t.reports.loadingAll} {pagedCount > 0 && `· ${formatNumber(pagedCount, 0)}`}
            </span>
          </div>
          {enrichTotal > 0 && (
            <span className="tabular-nums text-text-tertiary">
              {formatNumber(enrichDone, 0)} {t.common.of} {formatNumber(enrichTotal, 0)}
            </span>
          )}
        </div>
      ) : !hasData ? (
        <EmptyState icon={<Receipt size={20} />} title={t.reports.noData} description={t.reports.derivedHint} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <Stat label={t.reports.fees} value={formatCurrency(totals.fees)} />
            </Card>
            <Card>
              <Stat label={t.reports.taxes} value={formatCurrency(totals.taxes)} />
            </Card>
          </div>

          {capped && (
            <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs text-warning">
              <AlertTriangle size={14} className="shrink-0" />
              <span className="tabular-nums">
                {formatNumber(MAX_ENRICH, 0)} {t.common.of} {formatNumber(tradeRowCount, 0)}
              </span>
            </div>
          )}

          <Card>
            <CardTitle className="mb-3">
              {t.reports.fees} / {t.reports.taxes}
            </CardTitle>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yearBuckets} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke={theme.grid} vertical={false} />
                  <XAxis dataKey="year" tick={theme.axisTick} tickLine={false} axisLine={{ stroke: theme.grid }} />
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
                  <Bar dataKey="fees" name={t.reports.fees} fill={theme.series[3]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="taxes" name={t.reports.taxes} fill={theme.series[4]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <DataTable
            columns={yearColumns}
            rows={yearBuckets}
            rowKey={(r) => r.year}
            exportName="costs-by-year"
            initialSort={{ key: "year", direction: "desc" }}
          />

          <DataTable
            columns={typeColumns}
            rows={typeBuckets}
            rowKey={(r) => r.type}
            exportName="costs-by-type"
            initialSort={{ key: "fees", direction: "desc" }}
          />

          <p className="text-xs text-text-tertiary">{t.reports.derivedHint}</p>
        </>
      )}

      <CliCommand commands={cliCommands} variant="block" />
    </div>
  );
}
