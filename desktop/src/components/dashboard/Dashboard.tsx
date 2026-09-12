import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Stat from "../ui/Stat";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import { formatCurrency, formatNumber, formatPercent } from "../../lib/format";
import { useI18n } from "../../i18n";
import { TrendingUp, Moon, BarChart3, ShoppingBag, Briefcase } from "lucide-react";

export default function Dashboard() {
  const navigate = useNavigate();
  const { activePortfolioId } = useAppStore();
  const { t } = useI18n();
  const [overview, setOverview] = useState<any>(null);
  const [cash, setCash] = useState<any>(null);
  const [overnight, setOvernight] = useState<any>(null);
  const [holdings, setHoldings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [ov, cs, oh, hl] = await Promise.allSettled([
          api.getBrokerOverview(activePortfolioId || undefined),
          api.getBrokerCashBreakdown(activePortfolioId || undefined),
          api.getOvernight(),
          api.getHoldings(activePortfolioId || undefined),
        ]);
        // sc --json wraps each payload in {resolution, result: {...}}.
        if (ov.status === "fulfilled") setOverview((ov.value as any)?.result ?? null);
        if (cs.status === "fulfilled") setCash((cs.value as any)?.result ?? null);
        if (oh.status === "fulfilled") setOvernight((oh.value as any)?.result ?? null);
        if (hl.status === "fulfilled") setHoldings((hl.value as any)?.result?.items ?? []);
        // The portfolio overview is the dashboard's backbone: if it failed,
        // say so instead of rendering zeros.
        if (ov.status === "rejected") {
          setError((ov.reason as any)?.message || t.common.loadFailed);
        }
      } catch {
        setError(t.common.loadFailed);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [activePortfolioId, reloadKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={32} />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="text-center py-16 space-y-4">
        <p className="text-sm text-text-secondary max-w-md mx-auto whitespace-pre-line">{error}</p>
        <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
          {t.common.retry}
        </Button>
      </div>
    );
  }

  const totalValue: number = overview?.valuation?.total ?? 0;
  const dayChange: number =
    overview?.performance?.find((p: any) => p.timeframe === "ONE_DAY")?.simpleAbsoluteReturn ?? 0;
  const baseValue = totalValue - dayChange;
  const dayChangePercent = baseValue > 0 ? (dayChange / baseValue) * 100 : 0;
  const isPositive = dayChange >= 0;

  const quickActions = [
    { label: t.nav.transactions, icon: BarChart3, path: "/transactions" },
    { label: t.nav.savingsPlans, icon: TrendingUp, path: "/savings-plans" },
    { label: t.nav.watchlist, icon: ShoppingBag, path: "/watchlist" },
    { label: t.nav.overnight, icon: Moon, path: "/overnight" },
  ];

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="pb-8 border-b border-border">
        <Stat
          size="hero"
          label={t.dashboard.portfolioValue}
          value={formatCurrency(totalValue)}
          delta={{
            text: `${isPositive ? "+" : ""}${formatCurrency(dayChange)} · ${formatPercent(dayChangePercent)}`,
            positive: isPositive,
          }}
          sub={t.common.today}
        />
      </section>

      {/* Cash & Overnight */}
      <section className="grid grid-cols-2 divide-x divide-border pb-8 border-b border-border">
        <Stat
          size="lg"
          label={t.dashboard.cashBalance}
          value={formatCurrency(parseFloat(cash?.cash_balance || "0"))}
          sub={t.dashboard.buyingPower(formatCurrency(parseFloat(cash?.buying_power || "0")))}
        />
        <div className="pl-8">
          <Stat
            size="lg"
            label={t.dashboard.overnightSavings}
            value={formatCurrency(parseFloat(overnight?.balance || "0"))}
            sub={
              overnight?.interest_rate
                ? `${formatNumber(parseFloat(overnight.interest_rate) * 100)}% p.a.`
                : t.dashboard.rateUnavailable
            }
          />
        </div>
      </section>

      {/* Holdings */}
      <section>
        <CardHeader>
          <CardTitle>{t.dashboard.holdings}</CardTitle>
          <button
            onClick={() => navigate("/portfolio")}
            className="text-xs font-medium text-accent hover:text-accent-hover transition-colors cursor-pointer"
          >
            {t.dashboard.viewAll}
          </button>
        </CardHeader>
        {holdings.length === 0 ? (
          <EmptyState
            icon={<Briefcase size={20} />}
            title={t.dashboard.noHoldingsTitle}
            description={t.dashboard.noHoldingsDesc}
          />
        ) : (
          <div className="divide-y divide-border">
            {holdings.slice(0, 6).map((h: any, i: number) => {
              const ret =
                h.fifo_price && h.quote_mid_price != null
                  ? (h.quote_mid_price / h.fifo_price - 1) * 100
                  : 0;
              const isPos = ret >= 0;
              return (
                <div
                  key={h.isin || i}
                  className="group flex items-center justify-between py-3 px-2 -mx-2 rounded-lg hover:bg-bg-card-hover/60 transition-colors cursor-pointer"
                  onClick={() => navigate(`/security/${h.isin}`)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-bg-card flex items-center justify-center text-xs font-semibold text-text-tertiary shrink-0">
                      {(h.name || h.isin || "?").charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {h.name || h.isin}
                      </p>
                      <p className="text-2xs text-text-tertiary">{h.isin}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-text-primary tabular-nums">
                      {formatCurrency(h.valuation ?? 0)}
                    </p>
                    <p
                      className={`text-2xs font-medium tabular-nums ${
                        isPos ? "text-positive" : "text-negative"
                      }`}
                    >
                      {formatPercent(ret)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Quick actions */}
      <section className="grid grid-cols-4 gap-3">
        {quickActions.map((a) => (
          <button
            key={a.path}
            onClick={() => navigate(a.path)}
            className="flex items-center gap-3 p-4 bg-bg-card rounded-xl border border-border hover:bg-bg-card-hover hover:border-border-strong transition-all cursor-pointer"
          >
            <a.icon size={18} strokeWidth={1.75} className="text-text-secondary" />
            <span className="text-sm font-medium text-text-primary">{a.label}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
