import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Search, SearchX } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import { renderCliCommand } from "../../lib/cliLog";
import type { DerivativesData, DerivativeStrategy, DerivativeType } from "../../api/types";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import DataTable from "../ui/DataTable";
import CliCommand from "../ui/CliCommand";
import UnderlyingPicker, { type UnderlyingSelection } from "./UnderlyingPicker";
import UnderlyingPanel from "./UnderlyingPanel";
import DerivativeFilters from "./DerivativeFilters";
import { buildDerivativeColumns } from "./derivativeColumns";
import {
  DEFAULT_DERIVATIVES_LIMIT,
  DEFAULT_DERIVATIVE_FILTERS,
  ISIN_PATTERN,
  buildDerivativeParams,
  carryStrategy,
  type DerivativeFilterState,
} from "./derivativesLib";

/**
 * The CLI's single richest command surfaced as a screen: `sc broker
 * derivatives search` takes ~20 filters and the app never exposed it. This
 * pairs the full filter surface with the underlying's live quote/chart so a
 * knock-out barrier or a warrant's strike can actually be judged against
 * where the market is (moneyness) — see UnderlyingPanel.
 */
export default function Derivatives() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activePortfolioId = useAppStore((s) => s.activePortfolioId);
  const refreshToken = useAppStore((s) => s.refreshToken);
  const openTradeModal = useAppStore((s) => s.openTradeModal);
  const { t } = useI18n();

  const [underlying, setUnderlying] = useState<UnderlyingSelection | null>(null);
  const [derivativeType, setDerivativeType] = useState<DerivativeType>("knockout");
  const [strategy, setStrategy] = useState<DerivativeStrategy>("long");
  const [filters, setFilters] = useState<DerivativeFilterState>(DEFAULT_DERIVATIVE_FILTERS);
  const [limit, setLimit] = useState(DEFAULT_DERIVATIVES_LIMIT);
  const [offset, setOffset] = useState(0);

  const [result, setResult] = useState<DerivativesData["result"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const handleTypeChange = (next: DerivativeType) => {
    setDerivativeType(next);
    setStrategy((current) => carryStrategy(current, next));
    setOffset(0);
  };
  const handleStrategyChange = (next: DerivativeStrategy) => {
    setStrategy(next);
    setOffset(0);
  };
  const handleFiltersChange = (patch: Partial<DerivativeFilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setOffset(0);
  };
  const handleLimitChange = (next: number) => {
    setLimit(next);
    setOffset(0);
  };
  const handleResetFilters = () => {
    setFilters(DEFAULT_DERIVATIVE_FILTERS);
    setOffset(0);
  };
  const handleSelectUnderlying = (selection: UnderlyingSelection) => {
    setUnderlying(selection);
    setFilters(DEFAULT_DERIVATIVE_FILTERS);
    setOffset(0);
    setResult(null);
    setError(null);
  };
  const handleClearUnderlying = () => {
    setUnderlying(null);
    setResult(null);
    setError(null);
  };

  // A security's "Derivatives" link (SecurityDetail) arrives as
  // `/derivatives?underlying=<ISIN>` — preselect it once, then drop the
  // query param so it doesn't fight the in-page picker afterwards.
  useEffect(() => {
    const preselect = searchParams.get("underlying");
    if (!preselect) return;
    const clean = preselect.trim().toUpperCase();
    if (ISIN_PATTERN.test(clean)) {
      handleSelectUnderlying({ isin: clean, name: null });
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("underlying");
      return next;
    }, { replace: true });
    // Runs only off the URL param on mount/navigation, not on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const params = useMemo(
    () =>
      underlying
        ? buildDerivativeParams({
            underlying: underlying.isin,
            derivativeType,
            strategy,
            filters,
            limit,
            offset,
            portfolioId: activePortfolioId || undefined,
          })
        : null,
    [underlying, derivativeType, strategy, filters, limit, offset, activePortfolioId]
  );

  useEffect(() => {
    if (!underlying || !params) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const data = await api.getDerivatives(params);
        if (cancelled) return;
        setResult(data.result);
        // A filter change can make the current page fall past the new total —
        // snap back to the first page rather than showing an empty page.
        if (offset > 0 && offset >= data.result.total_available) setOffset(0);
      } catch (err) {
        if (!cancelled) {
          setResult(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlying, params, refreshToken, reloadKey]);

  const columns = useMemo(
    () => buildDerivativeColumns(t, derivativeType, (isin) => openTradeModal("buy", isin)),
    [t, derivativeType, openTradeModal]
  );

  const cliCommands = useMemo(() => {
    if (!underlying) return [renderCliCommand("search_derivatives", {})];
    const commands = [
      renderCliCommand("search_derivatives", params ?? {}),
      renderCliCommand("get_quote", { isin: underlying.isin, portfolioId: activePortfolioId || undefined }),
      renderCliCommand("get_chart", { isin: underlying.isin, timeframe: "1m" }),
    ];
    return commands;
  }, [underlying, params, activePortfolioId]);

  const items = result?.items ?? [];
  const total = result?.total_available ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.derivatives.title}</h1>
        <p className="text-sm text-text-secondary">{t.derivatives.subtitle}</p>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
        <p className="text-xs leading-relaxed text-warning">{t.derivatives.riskWarning}</p>
      </div>

      <div className="space-y-2">
        <span className="block text-sm font-medium text-text-secondary">{t.derivatives.underlying}</span>
        <UnderlyingPicker value={underlying} onSelect={handleSelectUnderlying} onClear={handleClearUnderlying} />
      </div>

      {!underlying ? (
        <EmptyState icon={<Search size={20} />} title={t.derivatives.pickUnderlying} />
      ) : (
        <>
          <UnderlyingPanel isin={underlying.isin} name={underlying.name} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
            <DerivativeFilters
              type={derivativeType}
              strategy={strategy}
              filters={filters}
              limit={limit}
              onTypeChange={handleTypeChange}
              onStrategyChange={handleStrategyChange}
              onFiltersChange={handleFiltersChange}
              onLimitChange={handleLimitChange}
              onReset={handleResetFilters}
            />

            <div className="min-w-0 space-y-3">
              {error && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-negative/20 bg-negative/10 p-3">
                  <p className="text-xs text-negative">{error}</p>
                  <Button size="sm" variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
                    {t.common.retry}
                  </Button>
                </div>
              )}

              {!error && (
                <p className="text-xs text-text-secondary tabular-nums">{t.derivatives.results(items.length, total)}</p>
              )}

              <DataTable
                columns={columns}
                rows={items}
                rowKey={(d) => d.isin}
                onRowClick={(d) => navigate(`/security/${d.isin}`)}
                loading={loading}
                exportName={`derivatives-${derivativeType}-${underlying.isin}`}
                empty={
                  <EmptyState
                    icon={<SearchX size={18} />}
                    title={t.derivatives.noResults}
                    description={t.derivatives.noResultsHint}
                  />
                }
              />

              {total > 0 && (
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" disabled={!canPrev} onClick={() => setOffset(Math.max(0, offset - limit))}>
                    {t.common.previous}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={!canNext} onClick={() => setOffset(offset + limit)}>
                    {t.common.next}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <CliCommand commands={cliCommands} variant="block" />
    </div>
  );
}
