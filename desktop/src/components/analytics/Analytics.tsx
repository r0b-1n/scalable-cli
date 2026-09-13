import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Button from "../ui/Button";
import Stat from "../ui/Stat";
import EmptyState from "../ui/EmptyState";
import CliCommand from "../ui/CliCommand";
import Skeleton, { SkeletonLines } from "../ui/Skeleton";
import { renderCliCommand } from "../../lib/cliLog";
import { formatDateTime, formatNumber } from "../../lib/format";
import { useI18n } from "../../i18n";
import type { AllocationEntry, BrokerAnalyticsData } from "../../api/types";
import { pickArray } from "./utils";
import AllocationDimensionCard from "./AllocationDimensionCard";
import InsightList from "./InsightList";
import { EquityStylesCard, FixedIncomeRatingsCard } from "./StyleRatingCards";
import { PieChart } from "lucide-react";

type AnalyticsResult = BrokerAnalyticsData["result"];

/** `portfolio_coverage` shows up as either a 0-1 fraction or a 0-100 figure. */
function coveragePercent(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return v <= 1 ? v * 100 : v;
}

export default function Analytics() {
  const activePortfolioId = useAppStore((s) => s.activePortfolioId);
  const refreshToken = useAppStore((s) => s.refreshToken);
  const { t } = useI18n();

  const [analytics, setAnalytics] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getBrokerAnalytics(activePortfolioId || undefined);
        if (!cancelled) setAnalytics(data.result);
      } catch (err) {
        if (!cancelled) {
          setAnalytics(null);
          setError((err as Error)?.message || t.common.loadFailed);
        }
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

  const cliCommands = useMemo(
    () => [renderCliCommand("get_broker_analytics", { portfolioId: activePortfolioId || undefined })],
    [activePortfolioId]
  );

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SkeletonLines rows={5} />
          <SkeletonLines rows={5} />
        </div>
      </div>
    );
  }

  if (error && !analytics) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{error}</p>
        <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
          {t.common.retry}
        </Button>
      </div>
    );
  }

  const allocations: AllocationEntry[] = analytics?.allocations ?? [];
  const healthChecks = analytics?.health_checks ?? [];
  const scenarios = analytics?.scenarios ?? [];
  const invalidSecurities = analytics?.invalid_securities ?? [];
  const hasEquityContent = pickArray(analytics?.equity_company_styles, ["market_caps"]).length > 0;
  const hasFixedIncomeContent = ["investment_grade", "speculative_grade", "unrated_grade"].some(
    (key) => pickArray(analytics?.fixed_income_ratings, [key]).length > 0
  );
  const coverage = coveragePercent(analytics?.portfolio_coverage);

  const groups = new Map<string, AllocationEntry[]>();
  for (const entry of allocations) {
    const dim = entry?.type || "OTHER";
    const bucket = groups.get(dim);
    if (bucket) bucket.push(entry);
    else groups.set(dim, [entry]);
  }

  const hasAnyContent =
    allocations.length > 0 ||
    healthChecks.length > 0 ||
    scenarios.length > 0 ||
    invalidSecurities.length > 0 ||
    hasEquityContent ||
    hasFixedIncomeContent ||
    coverage > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.analytics.title}</h1>
        <p className="text-sm text-text-secondary">{t.analytics.subtitle}</p>
      </div>

      {!hasAnyContent ? (
        <EmptyState icon={<PieChart size={20} />} title={t.analytics.noAnalysis} />
      ) : (
        <>
          <section className="border-b border-border pb-8">
            <Stat
              size="lg"
              label={t.analytics.coverage}
              value={`${formatNumber(coverage, 1)}%`}
              sub={t.analytics.coverageHint}
            />
            {analytics?.last_updated_utc && (
              <p className="mt-3 text-xs text-text-tertiary">
                {t.analytics.lastUpdated}: {formatDateTime(analytics.last_updated_utc)}
              </p>
            )}
          </section>

          {groups.size > 0 && (
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Array.from(groups.entries()).map(([dimension, entries]) => (
                <AllocationDimensionCard key={dimension} dimension={dimension} entries={entries} />
              ))}
            </section>
          )}

          {(healthChecks.length > 0 || scenarios.length > 0) && (
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <InsightList title={t.analytics.healthChecks} items={healthChecks} />
              <InsightList title={t.analytics.scenarios} items={scenarios} />
            </section>
          )}

          {(hasEquityContent || hasFixedIncomeContent) && (
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <EquityStylesCard data={analytics?.equity_company_styles} />
              <FixedIncomeRatingsCard data={analytics?.fixed_income_ratings} />
            </section>
          )}

          {invalidSecurities.length > 0 && (
            <InsightList title={t.analytics.invalidSecurities} items={invalidSecurities} />
          )}
        </>
      )}

      <CliCommand commands={cliCommands} variant="block" />
    </div>
  );
}
