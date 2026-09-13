import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Button from "../ui/Button";
import Skeleton, { SkeletonLines } from "../ui/Skeleton";
import CliCommand from "../ui/CliCommand";
import { renderCliCommand } from "../../lib/cliLog";
import { useI18n } from "../../i18n";
import type {
  BrokerCashBreakdownData,
  BrokerOverviewData,
  Holding,
  OvernightData,
  Transaction,
} from "../../api/types";
import HeroValuation from "./HeroValuation";
import CashOverview from "./CashOverview";
import AllocationSnapshot from "./AllocationSnapshot";
import TopMovers from "./TopMovers";
import OpenOrdersCard from "./OpenOrdersCard";
import RecentActivity from "./RecentActivity";
import QuickActions from "./QuickActions";

/** Statuses that mean "still working" — the open-orders preview card's filter. */
const OPEN_ORDER_STATUS_FILTER = ["PENDING", "CREATED", "REQUESTED", "PARTIAL_FILLED"];

/**
 * The landing screen: "how am I doing, and what needs me?" at a glance.
 * Every section reads its own slice of state so a partial failure (say,
 * `getOvernight` timing out) degrades that one section instead of blanking
 * the whole page — only `getBrokerOverview` failing blocks the screen, since
 * it is the hero figure everything else is framed around.
 */
export default function Dashboard() {
  const activePortfolioId = useAppStore((s) => s.activePortfolioId);
  const refreshToken = useAppStore((s) => s.refreshToken);
  const { t } = useI18n();

  const [overview, setOverview] = useState<BrokerOverviewData["result"] | null>(null);
  const [cash, setCash] = useState<BrokerCashBreakdownData["result"] | null>(null);
  const [overnight, setOvernight] = useState<OvernightData["result"] | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [openOrders, setOpenOrders] = useState<Transaction[]>([]);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const pid = activePortfolioId || undefined;
      try {
        const [ov, cs, on, hl, oo, rt] = await Promise.allSettled([
          api.getBrokerOverview(pid),
          api.getBrokerCashBreakdown(pid),
          api.getOvernight(),
          api.getHoldings({ portfolioId: pid }),
          api.getTransactions({ portfolioId: pid, status: OPEN_ORDER_STATUS_FILTER, pageSize: 10 }),
          api.getTransactions({ portfolioId: pid, pageSize: 6 }),
        ]);
        if (cancelled) return;

        if (ov.status === "fulfilled") {
          setOverview(ov.value.result);
        } else {
          setOverview(null);
          setError(ov.reason?.message || t.common.loadFailed);
        }
        setCash(cs.status === "fulfilled" ? cs.value.result : null);
        setOvernight(on.status === "fulfilled" ? on.value.result : null);
        setHoldings(hl.status === "fulfilled" ? hl.value.result.items : []);
        setOpenOrders(oo.status === "fulfilled" ? oo.value.result.items : []);
        setRecentTx(rt.status === "fulfilled" ? rt.value.result.items : []);
      } catch {
        if (!cancelled) setError(t.common.loadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortfolioId, refreshToken, reloadKey]);

  const cliCommands = useMemo(() => {
    const pid = activePortfolioId || undefined;
    return [
      renderCliCommand("get_broker_overview", { portfolioId: pid }),
      renderCliCommand("get_broker_cash_breakdown", { portfolioId: pid }),
      renderCliCommand("get_overnight", {}),
      renderCliCommand("get_holdings", { portfolioId: pid }),
      renderCliCommand("get_transactions", {
        portfolioId: pid,
        status: OPEN_ORDER_STATUS_FILTER,
        pageSize: 10,
      }),
      renderCliCommand("get_transactions", { portfolioId: pid, pageSize: 6 }),
    ];
  }, [activePortfolioId]);

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="space-y-3 border-b border-border pb-8">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid grid-cols-2 gap-4 border-b border-border pb-8 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <SkeletonLines rows={4} />
        <SkeletonLines rows={5} />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{error}</p>
        <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
          {t.common.retry}
        </Button>
      </div>
    );
  }

  const totalValue = overview?.valuation?.total ?? 0;
  const performance = overview?.performance ?? [];

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.nav.dashboard}</h1>

      <HeroValuation total={totalValue} performance={performance} />
      <CashOverview cash={cash} overnight={overnight} />
      <AllocationSnapshot holdings={holdings} />
      <TopMovers holdings={holdings} />
      <OpenOrdersCard orders={openOrders} />
      <RecentActivity items={recentTx} />
      <QuickActions />

      <CliCommand commands={cliCommands} variant="block" />
    </div>
  );
}
