import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Modal from "../ui/Modal";
import Badge from "../ui/Badge";
import EmptyState from "../ui/EmptyState";
import { formatCurrency } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import { Star, Plus, Trash2 } from "lucide-react";

export default function Watchlist() {
  const navigate = useNavigate();
  const { activePortfolioId } = useAppStore();
  const { t } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newIsin, setNewIsin] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadWatchlist = async () => {
    setLoading(true);
    try {
      const data = await api.getWatchlist(activePortfolioId || undefined);
      // sc --json wraps the payload in {resolution, result: {items}}.
      setItems((data as any)?.result?.items ?? []);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWatchlist();
  }, [activePortfolioId]);

  const handleAdd = async () => {
    if (adding || !newIsin.trim()) return;
    setAdding(true);
    setFormError(null);
    try {
      await api.addToWatchlist(newIsin.trim(), activePortfolioId || undefined);
      setNewIsin("");
      setAddModalOpen(false);
      loadWatchlist();
    } catch (err: any) {
      setFormError(err?.message || t.common.loadFailed);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (isin: string) => {
    try {
      await api.removeFromWatchlist(isin, activePortfolioId || undefined);
      loadWatchlist();
    } catch {
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t.watchlist.title}</h1>
        <Button size="sm" onClick={() => setAddModalOpen(true)}>
          <Plus size={14} className="mr-1.5" />
          {t.watchlist.addSecurity}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Star size={20} />}
          title={t.watchlist.emptyTitle}
          description={t.watchlist.emptyDesc}
          action={
            <Button size="sm" variant="secondary" onClick={() => setAddModalOpen(true)}>
              <Plus size={14} className="mr-1.5" />
              {t.watchlist.addSecurity}
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-border">
          {items.map((item: any) => (
            <div
              key={item.isin}
              className="group flex items-center justify-between px-2 -mx-2 py-3.5 rounded-lg hover:bg-bg-card-hover/60 transition-colors"
            >
              <div
                className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                onClick={() => navigate(`/security/${item.isin}`)}
              >
                <div className="w-9 h-9 rounded-full bg-bg-card flex items-center justify-center text-xs font-semibold text-text-tertiary shrink-0">
                  {(item.name || item.isin).charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {item.name || item.isin}
                  </p>
                  <p className="text-2xs text-text-tertiary">{item.isin}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {item.security_type && (
                  <Badge>{enumLabel(t.common.securityTypes, item.security_type)}</Badge>
                )}
                <p className="text-sm font-medium text-text-primary tabular-nums">
                  {item.quote_mid_price != null
                    ? formatCurrency(item.quote_mid_price, item.quote_currency || "EUR")
                    : "—"}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(item.isin);
                  }}
                  className="p-1.5 rounded-full text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-negative hover:bg-negative/10 transition-all cursor-pointer"
                  aria-label={t.watchlist.removeAria(item.isin)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={addModalOpen} onClose={() => setAddModalOpen(false)} title={t.watchlist.modalTitle}>
        <div className="space-y-4">
          <Input
            label={t.watchlist.isinLabel}
            placeholder={t.watchlist.isinPlaceholder}
            value={newIsin}
            onChange={(e) => setNewIsin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          {formError && (
            <div className="p-3 bg-negative/10 border border-negative/20 rounded-lg">
              <p className="text-xs text-negative">{formError}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddModalOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleAdd} disabled={adding}>
              {t.common.add}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
