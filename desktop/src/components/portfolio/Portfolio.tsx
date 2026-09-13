import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useToast } from "../ui/Toast";
import DataTable from "../ui/DataTable";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import CliCommand from "../ui/CliCommand";
import { SkeletonLines } from "../ui/Skeleton";
import { formatCurrency, formatPercent } from "../../lib/format";
import { renderCliCommand } from "../../lib/cliLog";
import { useI18n } from "../../i18n";
import type { Holding, PortfolioGroup, TradeSide } from "../../api/types";
import { useHoldingsColumns, sinceBuy } from "./holdingsColumns";
import BulkAssignModal from "./BulkAssignModal";
import { Briefcase, Users } from "lucide-react";

export default function Portfolio() {
  const navigate = useNavigate();
  const { activePortfolioId, refreshToken, openTradeModal } = useAppStore();
  const { t } = useI18n();
  const { push } = useToast();

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeYTD, setIncludeYTD] = useState(false);

  const [groups, setGroups] = useState<PortfolioGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignGroupId, setAssignGroupId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const loadHoldings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getHoldings({
        portfolioId: activePortfolioId || undefined,
        includeYearToDate: includeYTD,
      });
      setHoldings(data.result.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [activePortfolioId, includeYTD, t.common.loadFailed]);

  useEffect(() => {
    loadHoldings();
  }, [loadHoldings, refreshToken]);

  // Groups are fetched separately (only needed for the bulk-assign picker) so
  // a failure there never blocks the holdings table from rendering.
  useEffect(() => {
    api
      .getPortfolioGroups(activePortfolioId || undefined)
      .then((data) => setGroups(data.result.portfolio_groups ?? []))
      .catch(() => setGroups([]));
  }, [activePortfolioId, refreshToken]);

  const cliCommand = renderCliCommand("get_holdings", {
    portfolioId: activePortfolioId || undefined,
    includeYearToDate: includeYTD,
  });

  const totalValuation = useMemo(
    () => holdings.reduce((sum, h) => sum + (h.valuation ?? 0), 0),
    [holdings]
  );

  const totalPnl = useMemo(() => {
    let abs = 0;
    let costBasis = 0;
    for (const h of holdings) {
      abs += sinceBuy(h).abs;
      costBasis += (h.fifo_price ?? 0) * (h.quantity ?? 0);
    }
    return { abs, pct: costBasis > 0 ? (abs / costBasis) * 100 : 0 };
  }, [holdings]);

  const toggleSelected = useCallback((isin: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(isin)) next.delete(isin);
      else next.add(isin);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === holdings.length ? new Set() : new Set(holdings.map((h) => h.isin))
    );
  }, [holdings]);

  const handleTrade = useCallback(
    (side: TradeSide, isin: string) => openTradeModal(side, isin),
    [openTradeModal]
  );

  const handleAddToWatchlist = useCallback(
    async (isin: string) => {
      try {
        await api.addToWatchlist(isin, activePortfolioId || undefined);
        push({ tone: "success", title: t.watchlist.addSecurity });
      } catch (err) {
        push({
          tone: "error",
          title: t.common.loadFailed,
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [activePortfolioId, push, t.common.loadFailed, t.watchlist.addSecurity]
  );

  const handleBulkAssign = async () => {
    if (!assignGroupId || selected.size === 0) return;
    setAssigning(true);
    try {
      await api.assignToGroup({
        groupId: assignGroupId,
        isin: Array.from(selected),
        portfolioId: activePortfolioId || undefined,
      });
      push({ tone: "success", title: t.groups.assigned });
      setSelected(new Set());
      setAssignOpen(false);
      setAssignGroupId("");
    } catch (err) {
      push({
        tone: "error",
        title: t.common.loadFailed,
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setAssigning(false);
    }
  };

  const hasYTD = includeYTD && holdings.some((h) => h.year_to_date_performance != null);

  const columns = useHoldingsColumns({
    t,
    selected,
    toggleSelected,
    toggleSelectAll,
    holdingsCount: holdings.length,
    totalValuation,
    hasYTD,
    onTrade: handleTrade,
    onAddToWatchlist: handleAddToWatchlist,
  });

  if (error && holdings.length === 0) {
    return (
      <div className="space-y-8">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.portfolio.title}</h1>
        <div className="space-y-4 py-16 text-center">
          <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{error}</p>
          <Button variant="secondary" onClick={loadHoldings}>
            {t.common.retry}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.portfolio.title}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t.groups.subtitle}</p>
      </div>

      {loading ? (
        <SkeletonLines rows={3} />
      ) : (
        <section className="grid grid-cols-2 divide-x divide-border border-b border-border pb-6 sm:grid-cols-3">
          <div>
            <p className="text-xs text-text-secondary">{t.portfolio.totalValue}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
              {formatCurrency(totalValuation)}
            </p>
          </div>
          <div className="pl-6">
            <p className="text-xs text-text-secondary">{t.portfolio.totalReturn}</p>
            <p
              className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${
                totalPnl.abs >= 0 ? "text-positive" : "text-negative"
              }`}
            >
              {totalPnl.abs >= 0 ? "+" : ""}
              {formatCurrency(totalPnl.abs)}
              <span className="ml-2 text-sm font-medium">{formatPercent(totalPnl.pct)}</span>
            </p>
          </div>
          <div className="pl-6">
            <p className="text-xs text-text-secondary">{t.portfolio.holdingsCount}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
              {holdings.length}
            </p>
          </div>
        </section>
      )}

      <DataTable
        columns={columns}
        rows={holdings}
        rowKey={(h) => h.isin}
        onRowClick={(h) => navigate(`/security/${h.isin}`)}
        loading={loading}
        exportName="portfolio-holdings"
        initialSort={{ key: "valuation", direction: "desc" }}
        empty={
          <EmptyState
            icon={<Briefcase size={20} />}
            title={t.portfolio.noHoldingsTitle}
            description={t.portfolio.noHoldingsDesc}
          />
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setIncludeYTD((v) => !v)}
              aria-pressed={includeYTD}
              className={`cursor-pointer rounded-full px-3 py-1 text-2xs font-medium transition-colors ${
                includeYTD
                  ? "bg-accent-dim text-accent"
                  : "bg-hover text-text-secondary hover:text-text-primary"
              }`}
            >
              {t.security.timeframes.ytd}
            </button>
            {selected.size > 0 && (
              <div className="flex items-center gap-2 rounded-full bg-hover px-3 py-1">
                <Users size={13} className="text-text-tertiary" />
                <span className="text-2xs text-text-secondary">{selected.size}</span>
                <button
                  onClick={() => setAssignOpen(true)}
                  className="cursor-pointer text-2xs font-medium text-accent hover:text-accent-hover"
                >
                  {t.groups.assignTo}
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="cursor-pointer text-2xs text-text-tertiary hover:text-text-primary"
                >
                  {t.common.cancel}
                </button>
              </div>
            )}
          </div>
        }
      />

      <CliCommand commands={cliCommand} variant="block" />

      <BulkAssignModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        selectedCount={selected.size}
        isins={Array.from(selected)}
        portfolioId={activePortfolioId || undefined}
        groups={groups}
        groupId={assignGroupId}
        onGroupIdChange={setAssignGroupId}
        onConfirm={handleBulkAssign}
        busy={assigning}
      />
    </div>
  );
}
