import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Star, Upload } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import { useToast } from "../ui/Toast";
import { renderCliCommand } from "../../lib/cliLog";
import Button from "../ui/Button";
import DataTable from "../ui/DataTable";
import EmptyState from "../ui/EmptyState";
import CliCommand from "../ui/CliCommand";
import ConfirmDialog from "../ui/ConfirmDialog";
import { useWatchlistColumns, type WatchlistRow } from "./watchlistColumns";
import AddSecurityModal from "./AddSecurityModal";
import BulkImportModal from "./BulkImportModal";
import AlertQuickModal from "./AlertQuickModal";

export default function Watchlist() {
  const navigate = useNavigate();
  const { activePortfolioId, refreshToken, openTradeModal } = useAppStore();
  const { t } = useI18n();
  const { push } = useToast();

  const [items, setItems] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeYTD, setIncludeYTD] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [alertRow, setAlertRow] = useState<WatchlistRow | null>(null);
  const [removeRow, setRemoveRow] = useState<WatchlistRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getWatchlist({
        portfolioId: activePortfolioId || undefined,
        includeYearToDate: includeYTD,
      });
      setItems(data.result.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [activePortfolioId, includeYTD, t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const hasYTD = includeYTD && items.some((i) => i.year_to_date_performance != null);

  const handleBuy = useCallback((isin: string) => openTradeModal("buy", isin), [openTradeModal]);

  const handleRemoveConfirmed = async () => {
    if (!removeRow) return;
    setRemoving(true);
    try {
      await api.removeFromWatchlist(removeRow.isin, activePortfolioId || undefined);
      push({ tone: "success", title: t.watchlist.removed, description: removeRow.name || removeRow.isin });
      setRemoveRow(null);
      load();
    } catch (err) {
      push({
        tone: "error",
        title: t.common.actionFailed,
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRemoving(false);
    }
  };

  const columns = useWatchlistColumns({
    t,
    hasYTD,
    onBuy: handleBuy,
    onAlert: setAlertRow,
    onRemove: setRemoveRow,
  });

  const cliCommand = renderCliCommand("get_watchlist", {
    portfolioId: activePortfolioId || undefined,
    includeYearToDate: includeYTD,
  });

  if (error && items.length === 0) {
    return (
      <div className="space-y-8">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.watchlist.title}</h1>
        <div className="space-y-4 py-16 text-center">
          <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{error}</p>
          <Button variant="secondary" onClick={load}>
            {t.common.retry}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.watchlist.title}</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)}>
            <Upload size={14} className="mr-1.5" />
            {t.watchlist.bulkImport}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} className="mr-1.5" />
            {t.watchlist.addSecurity}
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(r) => r.isin}
        onRowClick={(r) => navigate(`/security/${r.isin}`)}
        loading={loading}
        exportName="watchlist"
        empty={
          <EmptyState
            icon={<Star size={20} />}
            title={t.watchlist.emptyTitle}
            description={t.watchlist.emptyDesc}
            action={
              <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
                <Plus size={14} className="mr-1.5" />
                {t.watchlist.addSecurity}
              </Button>
            }
          />
        }
        toolbar={
          <button
            onClick={() => setIncludeYTD((v) => !v)}
            aria-pressed={includeYTD}
            title={t.portfolio.yearToDateToggle}
            className={`cursor-pointer rounded-full px-3 py-1 text-2xs font-medium transition-colors ${
              includeYTD ? "bg-accent-dim text-accent" : "bg-hover text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.security.timeframes.ytd}
          </button>
        }
      />

      <CliCommand commands={cliCommand} variant="block" />

      <AddSecurityModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        portfolioId={activePortfolioId || undefined}
        onAdded={load}
      />
      <BulkImportModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        portfolioId={activePortfolioId || undefined}
        onDone={load}
      />
      {alertRow && (
        <AlertQuickModal row={alertRow} portfolioId={activePortfolioId || undefined} onClose={() => setAlertRow(null)} />
      )}
      <ConfirmDialog
        open={Boolean(removeRow)}
        onClose={() => setRemoveRow(null)}
        onConfirm={handleRemoveConfirmed}
        title={removeRow ? t.watchlist.removeAria(removeRow.isin) : ""}
        description={removeRow?.name}
        confirmLabel={t.groups.unassign}
        cancelLabel={t.common.cancel}
        tone="danger"
        busy={removing}
      />
    </div>
  );
}
