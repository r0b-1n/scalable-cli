import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import SegmentedControl from "../ui/SegmentedControl";
import Stat from "../ui/Stat";
import { formatCurrency, formatPercent, formatDate, formatDateTime, formatShortDate } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import { chart as chartTheme } from "../../lib/chartTheme";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ArrowLeft, Star, Plus, Minus } from "lucide-react";

const TIMEFRAME_VALUES = ["1d", "7d", "1m", "3m", "6m", "ytd", "1y", "max"];

export default function SecurityDetail() {
  const { isin } = useParams<{ isin: string }>();
  const navigate = useNavigate();
  const { openTradeModal } = useAppStore();
  const { t, lang } = useI18n();
  const [quote, setQuote] = useState<any>(null);
  const [chart, setChart] = useState<any>(null);
  const [news, setNews] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<string>("1m");

  useEffect(() => {
    if (!isin) return;
    const load = async () => {
      setLoading(true);
      try {
        const [qt, ch, nw] = await Promise.allSettled([
          api.getQuote(isin),
          api.getChart(isin, timeframe),
          api.getSecurityNews(isin, lang === "de" ? "de_DE" : "en_DE"),
        ]);
        // sc --json shapes: quote nests under result; chart/news are flat.
        if (qt.status === "fulfilled") setQuote((qt.value as any)?.result ?? null);
        if (ch.status === "fulfilled") setChart(ch.value ?? null);
        if (nw.status === "fulfilled") setNews(nw.value ?? null);
      } catch {
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isin, timeframe, lang]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={32} />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="text-center py-16">
        <p className="text-text-secondary">{t.security.notFound}</p>
        <Button variant="ghost" onClick={() => navigate(-1)} className="mt-4">
          <ArrowLeft size={16} className="mr-2" />
          {t.security.goBack}
        </Button>
      </div>
    );
  }

  const currency = quote.quote_currency || "EUR";
  const price = quote.quote_mid_price ?? 0;
  const oneDay = quote.quote_performances?.find((p: any) => p.timeframe === "ONE_DAY");
  const dayChange: number = oneDay?.simple_absolute_return ?? 0;
  const dayChangePercent: number = (oneDay?.performance ?? 0) * 100;
  const isPositive = dayChange >= 0;

  const points = (chart?.data_points ?? []).map((p: any) => ({
    time: p.timestamp_utc,
    value: p.mid_price,
  }));
  const lineColor = isPositive ? chartTheme.line : chartTheme.lineNegative;
  const gradFrom = isPositive ? chartTheme.gradientFrom : chartTheme.gradientFromNeg;
  const gradTo = isPositive ? chartTheme.gradientTo : chartTheme.gradientToNeg;

  const newsSources: any[] = news?.sources ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4 cursor-pointer"
          >
            <ArrowLeft size={15} />
            {t.security.back}
          </button>
          <Stat
            size="hero"
            label={`${quote.name || quote.isin} · ${quote.isin}`}
            value={formatCurrency(price, currency)}
            delta={{
              text: `${isPositive ? "+" : ""}${formatCurrency(dayChange, currency)} · ${formatPercent(dayChangePercent)}`,
              positive: isPositive,
            }}
            sub={t.common.today}
          />
        </div>
        <div className="flex items-center gap-2 pt-9">
          <Button variant="secondary" size="sm">
            <Star size={14} className="mr-1.5" />
            {t.security.watch}
          </Button>
          <Button size="sm" onClick={() => openTradeModal("buy", isin!)}>
            <Plus size={14} className="mr-1.5" />
            {t.security.buy}
          </Button>
          <Button variant="danger" size="sm" onClick={() => openTradeModal("sell", isin!)}>
            <Minus size={14} className="mr-1.5" />
            {t.security.sell}
          </Button>
        </div>
      </div>

      {/* Chart */}
      <section className="pb-8 border-b border-border">
        <div className="mb-4">
          <SegmentedControl
            options={TIMEFRAME_VALUES.map((tf) => ({
              value: tf,
              label: t.security.timeframes[tf] ?? tf.toUpperCase(),
            }))}
            value={timeframe}
            onChange={setTimeframe}
          />
        </div>
        <div className="h-[320px]">
          {points.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
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
                  width={56}
                  tickFormatter={(v) => formatCurrency(Number(v), currency)}
                />
                <Tooltip
                  contentStyle={chartTheme.tooltip}
                  labelStyle={chartTheme.tooltipLabel}
                  cursor={chartTheme.cursor}
                  formatter={(value: any) => [formatCurrency(Number(value), currency), t.security.chartPrice]}
                  labelFormatter={(v) => formatDateTime(String(v))}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={2}
                  fill="url(#chartFill)"
                  dot={false}
                  activeDot={{ r: 4, fill: lineColor, stroke: "none" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-text-secondary text-sm">
              {t.security.chartUnavailable}
            </div>
          )}
        </div>
      </section>

      {/* Key figures */}
      <section className="grid grid-cols-4 divide-x divide-border pb-8 border-b border-border">
        <Stat label={t.security.bid} value={quote.quote_bid_price != null ? formatCurrency(quote.quote_bid_price, currency) : "—"} />
        <div className="pl-6">
          <Stat label={t.security.ask} value={quote.quote_ask_price != null ? formatCurrency(quote.quote_ask_price, currency) : "—"} />
        </div>
        <div className="pl-6">
          <Stat label={t.security.currency} value={currency} />
        </div>
        <div className="pl-6">
          <Stat
            label={t.security.lastUpdated}
            value={
              <span className="text-sm font-medium">
                {quote.quote_timestamp_utc ? formatDateTime(quote.quote_timestamp_utc) : "—"}
              </span>
            }
            sub={quote.quote_is_outdated ? t.security.quoteOutdated : undefined}
          />
        </div>
      </section>

      {/* News */}
      {(newsSources.length > 0 || news?.summary?.short) && (
        <section>
          <CardHeader>
            <CardTitle>{t.security.latestNews}</CardTitle>
          </CardHeader>
          {news?.summary?.short && (
            <p className="text-sm text-text-secondary mb-4">{news.summary.short}</p>
          )}
          <div className="divide-y divide-border">
            {newsSources.slice(0, 5).map((item: any, i: number) => (
              <div key={item.id || i} className="py-3.5">
                <h4 className="text-sm font-medium text-text-primary">{item.headline}</h4>
                <div className="flex items-center gap-3 mt-1.5">
                  {item.source_name && (
                    <span className="text-2xs text-accent">{item.source_name}</span>
                  )}
                  {item.publication_time_utc && (
                    <span className="text-2xs text-text-tertiary">
                      {formatDate(item.publication_time_utc)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
