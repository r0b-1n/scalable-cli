import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";
import { chartTheme } from "../../lib/chartTheme";
import { formatCurrency, formatDateTime, formatShortDate } from "../../lib/format";
import { renderCliCommand } from "../../lib/cliLog";
import SegmentedControl from "../ui/SegmentedControl";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";
import CliCommand from "../ui/CliCommand";
import type { ChartData, ChartTimeframe } from "../../api/types";

const TIMEFRAMES: ChartTimeframe[] = ["1d", "7d", "1m", "3m", "6m", "ytd", "1y", "max"];
const DEFAULT_BENCHMARK = "IE00B4L5Y983"; // iShares Core MSCI World UCITS ETF
const ISIN_PATTERN = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/;

interface NormalizedPoint {
  ms: number;
  time: string;
  value: number;
}

/** Normalises a chart's data points to start at 100 so two series on
 * different price scales become visually comparable. */
function normalize(points: ChartData["data_points"]): NormalizedPoint[] {
  if (points.length === 0) return [];
  const base = points[0].mid_price || 1;
  return points.map((p) => ({
    ms: new Date(p.timestamp_utc).getTime(),
    time: p.timestamp_utc,
    value: (p.mid_price / base) * 100,
  }));
}

/** The two charts aren't guaranteed to share tick timestamps, so the overlay
 * matches each primary point to the closest benchmark point instead of
 * assuming the same index lines up. */
function nearestValue(series: NormalizedPoint[], targetMs: number): number | undefined {
  let best: number | undefined;
  let bestDiff = Infinity;
  for (const p of series) {
    const diff = Math.abs(p.ms - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p.value;
    }
  }
  return best;
}

interface SecurityPriceChartProps {
  isin: string;
  currency: string;
}

/**
 * The chart card: timeframe switcher over every CLI timeframe, plus an
 * optional benchmark overlay (composite) — a second ISIN's chart, normalised
 * to 100 alongside this security's, so relative performance reads directly
 * off the same axis regardless of either instrument's actual price level.
 */
export default function SecurityPriceChart({ isin, currency }: SecurityPriceChartProps) {
  const { t } = useI18n();
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1m");
  const [chart, setChart] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);

  const [benchmarkOn, setBenchmarkOn] = useState(false);
  const [benchmarkInput, setBenchmarkInput] = useState(DEFAULT_BENCHMARK);
  const [benchmarkChart, setBenchmarkChart] = useState<ChartData | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkInvalid, setBenchmarkInvalid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getChart(isin, timeframe)
      .then((data) => {
        if (!cancelled) setChart(data);
      })
      .catch(() => {
        if (!cancelled) setChart(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isin, timeframe]);

  useEffect(() => {
    if (!benchmarkOn) {
      setBenchmarkChart(null);
      return;
    }
    const clean = benchmarkInput.trim().toUpperCase();
    if (!ISIN_PATTERN.test(clean)) {
      setBenchmarkChart(null);
      setBenchmarkInvalid(true);
      return;
    }
    setBenchmarkInvalid(false);
    let cancelled = false;
    setBenchmarkLoading(true);
    api
      .getChart(clean, timeframe)
      .then((data) => {
        if (!cancelled) setBenchmarkChart(data);
      })
      .catch(() => {
        if (!cancelled) setBenchmarkChart(null);
      })
      .finally(() => {
        if (!cancelled) setBenchmarkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [benchmarkOn, benchmarkInput, timeframe]);

  const theme = chartTheme();
  const points = chart?.data_points ?? [];
  const benchmarkIsin = benchmarkInput.trim().toUpperCase();

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<ChartTimeframe>
          options={TIMEFRAMES.map((tf) => ({ value: tf, label: t.security.timeframes[tf] ?? tf.toUpperCase() }))}
          value={timeframe}
          onChange={setTimeframe}
        />
        <Button
          variant={benchmarkOn ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setBenchmarkOn((v) => !v)}
          aria-pressed={benchmarkOn}
          title={t.derivatives.underlying}
        >
          <BarChart3 size={14} className="mr-1.5" />
          {t.derivatives.underlying}
        </Button>
      </div>

      {benchmarkOn && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="w-56">
            <Input
              value={benchmarkInput}
              onChange={(e) => setBenchmarkInput(e.target.value)}
              placeholder={t.watchlist.isinPlaceholder}
              error={benchmarkInvalid ? t.common.loadFailed : undefined}
            />
          </div>
          {benchmarkLoading && <Spinner size={14} />}
          <div className="flex items-center gap-1.5 text-2xs text-text-secondary">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--sc-accent)" }} />
            {isin}
            <span className="ml-3 h-2 w-2 rounded-full border border-dashed" style={{ borderColor: theme.axisTick.fill }} />
            {benchmarkIsin}
          </div>
        </div>
      )}

      <div className="h-[320px]">
        {loading ? (
          <div className="h-full animate-shimmer rounded-xl bg-bg-card-hover" />
        ) : benchmarkOn && benchmarkChart ? (
          <ComparisonChart
            primary={normalize(points)}
            benchmark={normalize(benchmarkChart.data_points ?? [])}
            primaryLabel={isin}
            benchmarkLabel={benchmarkIsin}
          />
        ) : points.length > 0 ? (
          <PriceChart points={points} currency={currency} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-secondary">
            {t.security.chartUnavailable}
          </div>
        )}
      </div>

      <CliCommand
        commands={
          benchmarkOn
            ? [renderCliCommand("get_chart", { isin, timeframe }), renderCliCommand("get_chart", { isin: benchmarkIsin, timeframe })]
            : renderCliCommand("get_chart", { isin, timeframe })
        }
        variant="inline"
        className="mt-3"
      />
    </section>
  );
}

function PriceChart({ points, currency }: { points: ChartData["data_points"]; currency: string }) {
  const theme = chartTheme();
  const isUp = points.length > 1 ? points[points.length - 1].mid_price >= points[0].mid_price : true;
  const lineColor = isUp ? theme.line : theme.lineNegative;
  const gradFrom = isUp ? theme.gradientFrom : theme.gradientFromNeg;
  const gradTo = isUp ? theme.gradientTo : theme.gradientToNeg;
  const data = points.map((p) => ({ time: p.timestamp_utc, value: p.mid_price }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="securityChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={gradFrom} />
            <stop offset="100%" stopColor={gradTo} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={theme.grid} />
        <XAxis
          dataKey="time"
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
          domain={["auto", "auto"]}
          width={56}
          tickFormatter={(v) => formatCurrency(Number(v), currency)}
        />
        <Tooltip
          contentStyle={theme.tooltip}
          labelStyle={theme.tooltipLabel}
          cursor={theme.cursor}
          formatter={(value: unknown) => [formatCurrency(Number(value), currency), ""]}
          labelFormatter={(v) => formatDateTime(String(v))}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={lineColor}
          strokeWidth={2}
          fill="url(#securityChartFill)"
          dot={false}
          activeDot={{ r: 4, fill: lineColor, stroke: "none" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ComparisonChart({
  primary,
  benchmark,
  primaryLabel,
  benchmarkLabel,
}: {
  primary: NormalizedPoint[];
  benchmark: NormalizedPoint[];
  primaryLabel: string;
  benchmarkLabel: string;
}) {
  const theme = chartTheme();
  const merged = primary.map((p) => ({
    time: p.time,
    primary: p.value,
    benchmark: nearestValue(benchmark, p.ms),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={merged} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={theme.grid} />
        <XAxis
          dataKey="time"
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
          domain={["auto", "auto"]}
          width={44}
          tickFormatter={(v) => Number(v).toFixed(0)}
        />
        <Tooltip
          contentStyle={theme.tooltip}
          labelStyle={theme.tooltipLabel}
          cursor={theme.cursor}
          formatter={(value: unknown, name: string) => [
            value != null ? Number(value).toFixed(1) : "—",
            name === "primary" ? primaryLabel : benchmarkLabel,
          ]}
          labelFormatter={(v) => formatDateTime(String(v))}
        />
        <Line type="monotone" dataKey="primary" stroke="var(--sc-accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line
          type="monotone"
          dataKey="benchmark"
          stroke={theme.axisTick.fill}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          activeDot={{ r: 4 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
