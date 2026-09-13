import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import type { ChartTimeframe, Quote } from "../../api/types";
import { formatCurrency, formatDateTime, formatPercent, formatShortDate } from "../../lib/format";
import { chart as chartTheme } from "../../lib/chartTheme";
import Skeleton from "../ui/Skeleton";
import SegmentedControl from "../ui/SegmentedControl";
import Stat from "../ui/Stat";

const TIMEFRAMES: ChartTimeframe[] = ["1d", "1m", "1y"];

interface UnderlyingPanelProps {
  isin: string;
  name: string | null;
}

/**
 * Composite feature: the underlying's live quote + chart shown next to the
 * derivative results, so a knock-out barrier or a warrant's strike can be
 * judged against where the underlying is actually trading (moneyness).
 */
export default function UnderlyingPanel({ isin, name }: UnderlyingPanelProps) {
  const navigate = useNavigate();
  const activePortfolioId = useAppStore((s) => s.activePortfolioId);
  const refreshToken = useAppStore((s) => s.refreshToken);
  const { t } = useI18n();
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1m");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [points, setPoints] = useState<{ time: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [qt, ch] = await Promise.allSettled([
          api.getQuote(isin, { portfolioId: activePortfolioId || undefined }),
          api.getChart(isin, timeframe),
        ]);
        if (cancelled) return;
        setQuote(qt.status === "fulfilled" ? qt.value.result : null);
        setPoints(
          ch.status === "fulfilled"
            ? (ch.value.data_points ?? []).map((p) => ({ time: p.timestamp_utc, value: p.mid_price }))
            : []
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [isin, timeframe, activePortfolioId, refreshToken]);

  const currency = quote?.quote_currency || "EUR";
  const dayPerf = quote?.quote_performances?.find((p) => p.timeframe === "ONE_DAY");
  const dayChange: number = dayPerf?.simple_absolute_return ?? 0;
  const dayChangePercent: number = (dayPerf?.performance ?? 0) * 100;
  const isPositive = dayChange >= 0;
  const lineColor = isPositive ? chartTheme.line : chartTheme.lineNegative;
  const gradFrom = isPositive ? chartTheme.gradientFrom : chartTheme.gradientFromNeg;
  const gradTo = isPositive ? chartTheme.gradientTo : chartTheme.gradientToNeg;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          onClick={() => navigate(`/security/${isin}`)}
          className="group flex cursor-pointer items-center gap-1.5 text-left"
        >
          <div>
            <p className="text-sm font-medium text-text-primary">{name || isin}</p>
            <p className="text-2xs text-text-tertiary">{isin}</p>
          </div>
          <ArrowRight size={13} className="mt-0.5 text-text-tertiary transition-colors group-hover:text-text-primary" />
        </button>
        <SegmentedControl<ChartTimeframe>
          options={TIMEFRAMES.map((tf) => ({ value: tf, label: t.security.timeframes[tf] ?? tf }))}
          value={timeframe}
          onChange={setTimeframe}
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : quote ? (
        <>
          <Stat
            size="lg"
            label={t.security.chartPrice}
            value={formatCurrency(quote.quote_mid_price ?? 0, currency)}
            delta={{
              text: `${isPositive ? "+" : ""}${formatCurrency(dayChange, currency)} · ${formatPercent(dayChangePercent)}`,
              positive: isPositive,
            }}
          />
          <div className="h-32">
            {points.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="underlyingChartFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={gradFrom} />
                      <stop offset="100%" stopColor={gradTo} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={chartTheme.grid} />
                  <XAxis
                    dataKey="time"
                    tick={chartTheme.axisTick}
                    tickFormatter={(v) => formatShortDate(String(v))}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    tick={chartTheme.axisTick}
                    axisLine={false}
                    tickLine={false}
                    domain={["auto", "auto"]}
                    width={48}
                    tickFormatter={(v) => formatNumberShort(Number(v))}
                  />
                  <Tooltip
                    contentStyle={chartTheme.tooltip}
                    labelStyle={chartTheme.tooltipLabel}
                    cursor={chartTheme.cursor}
                    formatter={(value: number | string) => [
                      formatCurrency(Number(value), currency),
                      t.security.chartPrice,
                    ]}
                    labelFormatter={(v) => formatDateTime(String(v))}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={lineColor}
                    strokeWidth={2}
                    fill="url(#underlyingChartFill)"
                    dot={false}
                    activeDot={{ r: 3, fill: lineColor, stroke: "none" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-text-secondary">
                {t.security.chartUnavailable}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="py-6 text-center text-xs text-text-secondary">{t.security.chartUnavailable}</p>
      )}
    </div>
  );
}

function formatNumberShort(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : "";
}
