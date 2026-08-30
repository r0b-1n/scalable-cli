import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Badge from "../ui/Badge";
import { formatCurrency, formatPercent } from "../../lib/format";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Moon,
  BarChart3,
  ShoppingBag,
} from "lucide-react";

export default function Dashboard() {
  const navigate = useNavigate();
  const { activePortfolioId } = useAppStore();
  const [overview, setOverview] = useState<any>(null);
  const [cash, setCash] = useState<any>(null);
  const [overnight, setOvernight] = useState<any>(null);
  const [holdings, setHoldings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [ov, cs, oh, hl] = await Promise.allSettled([
          api.getBrokerOverview(activePortfolioId || undefined),
          api.getBrokerCashBreakdown(activePortfolioId || undefined),
          api.getOvernight(),
          api.getHoldings(activePortfolioId || undefined),
        ]);
        if (ov.status === "fulfilled") setOverview(ov.value);
        if (cs.status === "fulfilled") setCash(cs.value);
        if (oh.status === "fulfilled") setOvernight(oh.value);
        if (hl.status === "fulfilled") {
          const data = hl.value as any;
          setHoldings(data.holdings || data || []);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [activePortfolioId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={32} />
      </div>
    );
  }

  const totalValue = overview?.totalValue || "0";
  const dayChange = overview?.dayChange || "0";
  const dayChangePercent = overview?.dayChangePercent || "0";
  const isPositive = parseFloat(dayChange) >= 0;

  return (
    <div className="space-y-6 max-w-7xl">
      <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>

      {/* Portfolio Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="lg:col-span-2">
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">Portfolio Value</p>
            <div className="flex items-end gap-3">
              <span className="text-3xl font-bold text-text-primary">
                {formatCurrency(parseFloat(totalValue))}
              </span>
              <div
                className={`flex items-center gap-1 text-sm font-medium ${
                  isPositive ? "text-positive" : "text-negative"
                }`}
              >
                {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {formatPercent(parseFloat(dayChangePercent))}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-text-secondary">
              <Wallet size={16} />
              <p className="text-sm">Cash Balance</p>
            </div>
            <p className="text-xl font-bold text-text-primary">
              {formatCurrency(parseFloat(cash?.cashBalance || "0"))}
            </p>
            <p className="text-xs text-text-secondary">
              Buying power: {formatCurrency(parseFloat(cash?.buyingPower || "0"))}
            </p>
          </div>
        </Card>

        <Card>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-text-secondary">
              <Moon size={16} />
              <p className="text-sm">Overnight Savings</p>
            </div>
            <p className="text-xl font-bold text-text-primary">
              {formatCurrency(parseFloat(overnight?.balance || "0"))}
            </p>
            <p className="text-xs text-text-secondary">
              {overnight?.interestRate ? `${overnight.interestRate}% p.a.` : "Rate unavailable"}
            </p>
          </div>
        </Card>
      </div>

      {/* Top Holdings */}
      <Card>
        <CardHeader>
          <CardTitle>Holdings</CardTitle>
          <button
            onClick={() => navigate("/portfolio")}
            className="text-xs text-accent hover:text-accent-hover transition-colors"
          >
            View all
          </button>
        </CardHeader>
        {holdings.length === 0 ? (
          <p className="text-sm text-text-secondary py-4">No holdings found</p>
        ) : (
          <div className="space-y-3">
            {holdings.slice(0, 6).map((h: any, i: number) => {
              const ret = parseFloat(h.totalReturnPercent || h.dayChangePercent || "0");
              const isPos = ret >= 0;
              return (
                <div
                  key={h.isin || i}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-bg-card-hover transition-colors cursor-pointer"
                  onClick={() => navigate(`/security/${h.isin}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-bg-primary flex items-center justify-center text-xs font-bold text-text-secondary">
                      {(h.name || h.isin || "?").charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary truncate max-w-[200px]">
                        {h.name || h.isin}
                      </p>
                      <p className="text-xs text-text-secondary">{h.isin}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-text-primary">
                      {formatCurrency(parseFloat(h.currentValue || h.currentPrice || "0"))}
                    </p>
                    <p className={`text-xs font-medium ${isPos ? "text-positive" : "text-negative"}`}>
                      {formatPercent(ret)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={() => navigate("/transactions")}
          className="flex items-center gap-3 p-4 bg-bg-card border border-border rounded-xl hover:border-accent/20 hover:bg-bg-card-hover transition-all"
        >
          <BarChart3 size={20} className="text-accent" />
          <span className="text-sm font-medium text-text-primary">Transactions</span>
        </button>
        <button
          onClick={() => navigate("/savings-plans")}
          className="flex items-center gap-3 p-4 bg-bg-card border border-border rounded-xl hover:border-accent/20 hover:bg-bg-card-hover transition-all"
        >
          <TrendingUp size={20} className="text-accent" />
          <span className="text-sm font-medium text-text-primary">Savings Plans</span>
        </button>
        <button
          onClick={() => navigate("/watchlist")}
          className="flex items-center gap-3 p-4 bg-bg-card border border-border rounded-xl hover:border-accent/20 hover:bg-bg-card-hover transition-all"
        >
          <ShoppingBag size={20} className="text-accent" />
          <span className="text-sm font-medium text-text-primary">Watchlist</span>
        </button>
        <button
          onClick={() => navigate("/overnight")}
          className="flex items-center gap-3 p-4 bg-bg-card border border-border rounded-xl hover:border-accent/20 hover:bg-bg-card-hover transition-all"
        >
          <Moon size={20} className="text-accent" />
          <span className="text-sm font-medium text-text-primary">Overnight</span>
        </button>
      </div>
    </div>
  );
}
