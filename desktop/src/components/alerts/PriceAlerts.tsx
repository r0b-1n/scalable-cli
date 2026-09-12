import { useEffect, useState } from "react";
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
import { Bell, Plus, Trash2 } from "lucide-react";

export default function PriceAlerts() {
  const { activePortfolioId } = useAppStore();
  const { t } = useI18n();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [formIsin, setFormIsin] = useState("");
  const [formTicker, setFormTicker] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const data = await api.getPriceAlerts(activePortfolioId || undefined);
      // sc --json wraps the payload in {resolution, result: {items}}.
      setAlerts((data as any)?.result?.items ?? []);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, [activePortfolioId]);

  const handleAdd = async () => {
    if (adding || !formPrice.trim()) return;
    if (!formIsin.trim() && !formTicker.trim()) return;
    setAdding(true);
    setFormError(null);
    try {
      await api.addPriceAlert({
        isin: formIsin.trim() || undefined,
        ticker: formTicker.trim() || undefined,
        price: formPrice.trim(),
        portfolioId: activePortfolioId || undefined,
      });
      setFormIsin("");
      setFormTicker("");
      setFormPrice("");
      setAddModalOpen(false);
      loadAlerts();
    } catch (err: any) {
      setFormError(err?.message || t.common.loadFailed);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (alertId: string) => {
    try {
      await api.removePriceAlert(alertId, activePortfolioId || undefined);
      loadAlerts();
    } catch {
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t.alerts.title}</h1>
        <Button size="sm" onClick={() => setAddModalOpen(true)}>
          <Plus size={14} className="mr-1.5" />
          {t.alerts.newAlert}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={<Bell size={20} />}
          title={t.alerts.emptyTitle}
          description={t.alerts.emptyDesc}
          action={
            <Button size="sm" variant="secondary" onClick={() => setAddModalOpen(true)}>
              <Plus size={14} className="mr-1.5" />
              {t.alerts.newAlert}
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-border">
          {alerts.map((alert: any) => (
            <div
              key={alert.alert_id}
              className="group flex items-center justify-between px-2 -mx-2 py-3.5 rounded-lg hover:bg-bg-card-hover/60 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-accent-dim flex items-center justify-center shrink-0">
                  <Bell size={15} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {alert.name || alert.isin || "—"}
                  </p>
                  <p className="text-2xs text-text-tertiary tabular-nums">
                    {enumLabel(t.alerts.directions, alert.direction || "above")}{" "}
                    {formatCurrency(parseFloat(alert.price || "0"))}
                    {alert.isin ? ` · ${alert.isin}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Badge variant={alert.triggered_timestamp_utc ? "warning" : alert.is_active ? "positive" : "default"}>
                  {alert.triggered_timestamp_utc ? t.alerts.triggered : alert.is_active ? t.alerts.active : t.alerts.inactive}
                </Badge>
                <button
                  onClick={() => handleRemove(alert.alert_id)}
                  className="p-1.5 rounded-full text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-negative hover:bg-negative/10 transition-all cursor-pointer"
                  aria-label={t.alerts.removeAria}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={addModalOpen} onClose={() => setAddModalOpen(false)} title={t.alerts.modalTitle}>
        <div className="space-y-4">
          <Input
            label={t.alerts.isinLabel}
            placeholder={t.watchlist.isinPlaceholder}
            value={formIsin}
            onChange={(e) => setFormIsin(e.target.value)}
          />
          <Input
            label={t.alerts.tickerLabel}
            placeholder={t.alerts.tickerPlaceholder}
            value={formTicker}
            onChange={(e) => setFormTicker(e.target.value)}
          />
          <Input
            label={t.alerts.targetPrice}
            type="number"
            placeholder={t.alerts.pricePlaceholder}
            value={formPrice}
            onChange={(e) => setFormPrice(e.target.value)}
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
              {t.alerts.createAlert}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
