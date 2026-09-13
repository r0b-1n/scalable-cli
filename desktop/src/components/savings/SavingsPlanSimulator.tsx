import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Calculator } from "lucide-react";
import { api } from "../../api/client";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Badge from "../ui/Badge";
import Stat from "../ui/Stat";
import CliCommand from "../ui/CliCommand";
import { SkeletonLines } from "../ui/Skeleton";
import EmptyState from "../ui/EmptyState";
import { chart as chartTheme } from "../../lib/chartTheme";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency, formatPercent, formatShortDate } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import type { ChartTimeframe } from "../../api/types";
import { ISIN_PATTERN, frequencyKey } from "./savingsData";

const FREQUENCY_DAYS: Record<string, number> = {
  monthly: 30,
  "bi-monthly": 61,
  quarterly: 91,
  "semi-annually": 182,
  annually: 365,
};
const FREQUENCY_VALUES = Object.keys(FREQUENCY_DAYS);
const TIMEFRAMES: ChartTimeframe[] = ["6m", "1y", "max"];

interface SimPoint {
  date: string;
  contributed: number;
  value: number;
}

function simulate(
  points: { mid_price: number; timestamp_utc: string }[],
  amount: number,
  intervalDays: number
): { series: SimPoint[]; contributed: number; value: number; currency: string } {
  const sorted = [...points].sort(
    (a, b) => new Date(a.timestamp_utc).getTime() - new Date(b.timestamp_utc).getTime()
  );
  if (sorted.length === 0 || amount <= 0) return { series: [], contributed: 0, value: 0, currency: "EUR" };

  const first = new Date(sorted[0].timestamp_utc).getTime();
  const last = new Date(sorted[sorted.length - 1].timestamp_utc).getTime();
  const stepMs = intervalDays * 24 * 60 * 60 * 1000;

  const nearestPrice = (atMs: number) => {
    let best = sorted[0];
    let bestDiff = Math.abs(new Date(best.timestamp_utc).getTime() - atMs);
    for (const p of sorted) {
      const diff = Math.abs(new Date(p.timestamp_utc).getTime() - atMs);
      if (diff < bestDiff) {
        best = p;
        bestDiff = diff;
      }
    }
    return best.mid_price;
  };

  const series: SimPoint[] = [];
  let shares = 0;
  let contributed = 0;
  for (let t = first; t <= last; t += stepMs) {
    const price = nearestPrice(t);
    if (price > 0) shares += amount / price;
    contributed += amount;
    series.push({
      date: new Date(t).toISOString(),
      contributed,
      value: shares * price,
    });
  }
  const lastPrice = sorted[sorted.length - 1].mid_price;
  return { series, contributed, value: shares * lastPrice, currency: "EUR" };
}

/**
 * Savings-plan simulator (composite): projects a DCA outcome from the
 * security's own price history (`get_chart`). This is a local, client-side
 * estimate — not a forecast the CLI provides — so it is labelled and capped
 * accordingly: nearest available historical price per contribution date,
 * no fees/taxes/dynamization modelled.
 */
export default function SavingsPlanSimulator({ portfolioId }: { portfolioId?: string }) {
  const { t } = useI18n();
  const [isin, setIsin] = useState("");
  const [amount, setAmount] = useState("100");
  const [frequency, setFrequency] = useState("monthly");
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1y");

  const [currency, setCurrency] = useState("EUR");
  const [points, setPoints] = useState<{ mid_price: number; timestamp_utc: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clean = isin.trim().toUpperCase();
    if (!ISIN_PATTERN.test(clean)) {
      setPoints([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const data = await api.getChart(clean, timeframe);
        if (cancelled) return;
        setPoints(data.data_points ?? []);
        setCurrency(data.currency || "EUR");
        if (!data.data_points?.length) setError(t.security.chartUnavailable);
      } catch (err) {
        if (!cancelled) {
          setPoints([]);
          setError(err instanceof Error ? err.message : t.common.loadFailed);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isin, timeframe, t.security.chartUnavailable, t.common.loadFailed]);

  const result = useMemo(
    () => simulate(points, parseFloat(amount) || 0, FREQUENCY_DAYS[frequency] ?? 30),
    [points, amount, frequency]
  );
  const gain = result.value - result.contributed;
  const gainPct = result.contributed > 0 ? (gain / result.contributed) * 100 : 0;
  const theme = chartTheme;

  return (
    <Card className="space-y-5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calculator size={15} className="text-text-tertiary" />
          <CardTitle>{t.savings.title}</CardTitle>
        </div>
        <Badge variant="accent">{t.common.derived}</Badge>
      </CardHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Input
          label={t.watchlist.isinLabel}
          placeholder={t.watchlist.isinPlaceholder}
          value={isin}
          onChange={(e) => setIsin(e.target.value.toUpperCase())}
        />
        <Input
          label={t.savings.amountLabel}
          type="number"
          placeholder={t.savings.amountPlaceholder}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select
          label={t.savings.frequencyLabel}
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          options={FREQUENCY_VALUES.map((f) => ({ value: f, label: enumLabel(t.savings.frequencies, frequencyKey(f)) }))}
        />
        <div className="space-y-1.5">
          <span className="block font-mono text-2xs text-text-tertiary">--timeframe</span>
          <Select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as ChartTimeframe)}
            options={TIMEFRAMES.map((tf) => ({ value: tf, label: t.security.timeframes[tf] ?? tf }))}
          />
        </div>
      </div>

      {loading ? (
        <SkeletonLines rows={3} />
      ) : !isin.trim() ? (
        <EmptyState title={t.savings.emptyDesc} />
      ) : error ? (
        <p className="text-sm text-negative">{error}</p>
      ) : result.series.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label={t.reports.total} value={formatCurrency(result.contributed, currency)} />
            <Stat label={t.portfolio.colValue} value={formatCurrency(result.value, currency)} />
            <Stat
              label={t.portfolio.colReturn}
              value={
                <span className={gain >= 0 ? "text-positive" : "text-negative"}>
                  {gain >= 0 ? "+" : ""}
                  {formatCurrency(gain, currency)}
                </span>
              }
              sub={formatPercent(gainPct)}
            />
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={result.series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="simValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.gradientFrom} />
                    <stop offset="100%" stopColor={theme.gradientTo} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={theme.grid} />
                <XAxis
                  dataKey="date"
                  tick={theme.axisTick}
                  tickFormatter={(v) => formatShortDate(String(v))}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tick={theme.axisTick}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={(v) => formatCurrency(Number(v), currency)}
                />
                <Tooltip
                  contentStyle={theme.tooltip}
                  labelStyle={theme.tooltipLabel}
                  cursor={theme.cursor}
                  formatter={(v: number, name: string) => [formatCurrency(v, currency), name]}
                  labelFormatter={(v) => formatShortDate(String(v))}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: theme.axisTick.fill }} />
                <Area
                  type="monotone"
                  dataKey="contributed"
                  name={t.reports.total}
                  stroke={theme.axisTick.fill}
                  fill="transparent"
                  strokeDasharray="4 3"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  name={t.portfolio.colValue}
                  stroke={theme.line}
                  fill="url(#simValue)"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <p className="text-xs text-text-tertiary">{t.reports.derivedHint}</p>
        </>
      ) : (
        <EmptyState title={t.security.chartUnavailable} />
      )}

      <CliCommand
        commands={renderCliCommand("get_chart", { isin: isin.trim().toUpperCase(), timeframe })}
      />
    </Card>
  );
}
