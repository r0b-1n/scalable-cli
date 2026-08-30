import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import { formatCurrency, formatPercent, formatNumber } from "../../lib/format";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ArrowLeft, TrendingUp, Star, Plus, Minus } from "lucide-react";

export default function SecurityDetail() {
  const { isin } = useParams<{ isin: string }>();
  const navigate = useNavigate();
  const { openTradeModal, addToWatchlist } = useAppStore();
  const [quote, setQuote] = useState<any>(null);
  const [chart, setChart] = useState<any>(null);
  const [news, setNews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState("1m");

  useEffect(() => {
    if (!isin) return;
    const load = async () => {
      setLoading(true);
      try {
        const [qt, ch, nw] = await Promise.allSettled([
          api.getQuote(isin),
          api.getChart(isin, timeframe),
          api.getSecurityNews(isin),
        ]);
        if (qt.status === "fulfilled") setQuote(qt.value);
        if (ch.status === "fulfilled") setChart(ch.value);
        if (nw.status === "fulfilled") {
          const data = nw.value as any;
          setNews(data.news || []);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isin, timeframe]);

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
        <p className="text-text-secondary">Security not found</p>
        <Button variant="ghost" onClick={() => navigate(-1)} className="mt-4">
          <ArrowLeft size={16} className="mr-2" />
          Go back
        </Button>
      </div>
    );
  }

  const price = parseFloat(quote.price || "0");
  const dayChange = parseFloat(quote.dayChange || "0");
  const dayChangePercent = parseFloat(quote.dayChangePercent || "0");
  const isPositive = dayChange >= 0;

  const timeframes = [
    { value: "1d", label: "1D" },
    { value: "7d", label: "1W" },
    { value: "1m", label: "1M" },
    { value: "3m", label: "3M" },
    { value: "6m", label: "6M" },
    { value: "ytd", label: "YTD" },
    { value: "1y", label: "1Y" },
    { value: "max", label: "MAX" },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors mb-3"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <h1 className="text-2xl font-bold text-text-primary">
            {quote.name || quote.isin}
          </h1>
          <p className="text-sm text-text-secondary mt-1">{quote.isin}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm">
            <Star size={14} className="mr-1" />
            Watch
          </Button>
          <Button size="sm" onClick={() => openTradeModal("buy", isin!)}>
            <Plus size={14} className="mr-1" />
            Buy
          </Button>
          <Button variant="danger" size="sm" onClick={() => openTradeModal("sell", isin!)}>
            <Minus size={14} className="mr-1" />
            Sell
          </Button>
        </div>
      </div>

      {/* Price & Change */}
      <div className="flex items-end gap-4">
        <span className="text-4xl font-bold text-text-primary">
          {formatCurrency(price)}
        </span>
        <div className={`flex items-center gap-2 text-lg font-medium ${isPositive ? "text-positive" : "text-negative"}`}>
          <span>{isPositive ? "+" : ""}{formatCurrency(dayChange)}</span>
          <span>({formatPercent(dayChangePercent)})</span>
        </div>
      </div>

      {/* Chart */}
      <Card>
        <div className="flex items-center gap-1 mb-4">
          {timeframes.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                timeframe === tf.value
                  ? "bg-accent-dim text-accent"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className="h-[300px]">
          {chart?.points && chart.points.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chart.points.map((p: any) => ({
                  time: p.time,
                  value: p.close,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2C2D32" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: "#8B8D97" }}
                  tickFormatter={(v) => {
                    const d = new Date(v);
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                  }}
                  stroke="#2C2D32"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#8B8D97" }}
                  stroke="#2C2D32"
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1E1F23",
                    border: "1px solid #2C2D32",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: "#8B8D97" }}
                  formatter={(value: any) => [formatCurrency(Number(value)), "Price"]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={isPositive ? "#28EBCF" : "#FF6B6B"}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: isPositive ? "#28EBCF" : "#FF6B6B" }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-text-secondary text-sm">
              Chart data unavailable
            </div>
          )}
        </div>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {quote.marketCap && (
          <Card>
            <p className="text-xs text-text-secondary mb-1">Market Cap</p>
            <p className="text-sm font-semibold text-text-primary">{quote.marketCap}</p>
          </Card>
        )}
        {quote.pe && (
          <Card>
            <p className="text-xs text-text-secondary mb-1">P/E Ratio</p>
            <p className="text-sm font-semibold text-text-primary">{quote.pe}</p>
          </Card>
        )}
        {quote.dividendYield && (
          <Card>
            <p className="text-xs text-text-secondary mb-1">Dividend Yield</p>
            <p className="text-sm font-semibold text-accent">{quote.dividendYield}</p>
          </Card>
        )}
        {quote.beta && (
          <Card>
            <p className="text-xs text-text-secondary mb-1">Beta (1Y)</p>
            <p className="text-sm font-semibold text-text-primary">{quote.beta}</p>
          </Card>
        )}
      </div>

      {/* News */}
      {news.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Latest News</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            {news.slice(0, 5).map((item: any, i: number) => (
              <div key={i} className="p-3 bg-bg-primary rounded-lg border border-border/50">
                <h4 className="text-sm font-medium text-text-primary">{item.title}</h4>
                {item.summary && (
                  <p className="text-xs text-text-secondary mt-1 line-clamp-2">{item.summary}</p>
                )}
                <div className="flex items-center gap-3 mt-2">
                  {item.source && (
                    <span className="text-[11px] text-accent">{item.source}</span>
                  )}
                  {item.publishedAt && (
                    <span className="text-[11px] text-text-secondary">
                      {new Date(item.publishedAt).toLocaleDateString("de-DE")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
