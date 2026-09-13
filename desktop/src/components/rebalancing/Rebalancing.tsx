import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Button from "../ui/Button";
import CliCommand from "../ui/CliCommand";
import EmptyState from "../ui/EmptyState";
import { SkeletonLines } from "../ui/Skeleton";
import { renderCliCommand } from "../../lib/cliLog";
import { useI18n } from "../../i18n";
import type { Holding } from "../../api/types";
import { Scale } from "lucide-react";
import RebalancingTable from "./RebalancingTable";
import RebalancingPlan from "./RebalancingPlan";
import { currentWeightTargets, equalWeightTargets, loadTargets, saveTargets } from "./rebalancingUtils";

const DEFAULT_TOLERANCE = 2;

/**
 * `/rebalancing` — Rebalancing Planner (composite). Loads `get_holdings`,
 * lets the user set a per-holding target weight (persisted to
 * `localStorage`, portfolio-scoped), shows target vs actual vs drift with a
 * tolerance band, and generates a local order plan whose "prepare order"
 * rows open the real two-phase trade ticket via `openTradeModal`.
 */
export default function Rebalancing() {
  const { activePortfolioId, refreshToken } = useAppStore();
  const { t } = useI18n();
  const portfolioId = activePortfolioId || undefined;

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [targets, setTargets] = useState<Record<string, number>>({});
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getHoldings({ portfolioId });
      setHoldings(data.result.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [portfolioId, t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  // Targets are portfolio-scoped local state; reload them whenever the
  // active portfolio changes so switching portfolios never bleeds targets
  // from one into another.
  useEffect(() => {
    setTargets(loadTargets(portfolioId));
  }, [portfolioId]);

  const totalValuation = useMemo(() => holdings.reduce((sum, h) => sum + (h.valuation ?? 0), 0), [holdings]);

  const updateTargets = useCallback(
    (next: Record<string, number>) => {
      setTargets(next);
      saveTargets(portfolioId, next);
    },
    [portfolioId]
  );

  const handleTargetChange = (isin: string, pct: number) => {
    updateTargets({ ...targets, [isin]: pct });
  };
  const handleEqualWeight = () => updateTargets(equalWeightTargets(holdings));
  const handleUseCurrent = () => updateTargets(currentWeightTargets(holdings, totalValuation));

  const cliCommand = renderCliCommand("get_holdings", { portfolioId });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.rebalancing.title}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t.rebalancing.subtitle}</p>
      </div>

      {loading ? (
        <SkeletonLines rows={4} />
      ) : error ? (
        <div className="space-y-4 py-16 text-center">
          <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{error}</p>
          <Button variant="secondary" onClick={load}>
            {t.common.retry}
          </Button>
        </div>
      ) : holdings.length === 0 ? (
        <EmptyState icon={<Scale size={20} />} title={t.portfolio.noHoldingsTitle} description={t.portfolio.noHoldingsDesc} />
      ) : (
        <>
          <RebalancingTable
            holdings={holdings}
            targets={targets}
            onTargetChange={handleTargetChange}
            totalValuation={totalValuation}
            tolerance={tolerance}
            onToleranceChange={setTolerance}
            onEqualWeight={handleEqualWeight}
            onUseCurrent={handleUseCurrent}
          />

          <RebalancingPlan holdings={holdings} targets={targets} totalValuation={totalValuation} tolerance={tolerance} />
        </>
      )}

      <CliCommand commands={cliCommand} variant="block" />
    </div>
  );
}
