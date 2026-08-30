import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card from "../ui/Card";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Modal from "../ui/Modal";
import { Bell, Plus, Trash2 } from "lucide-react";

export default function PriceAlerts() {
  const { activePortfolioId } = useAppStore();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [formIsin, setFormIsin] = useState("");
  const [formTicker, setFormTicker] = useState("");
  const [formPrice, setFormPrice] = useState("");

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const data = await api.getPriceAlerts(activePortfolioId || undefined);
      setAlerts((data as any).alerts || []);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, [activePortfolioId]);

  const handleAdd = async () => {
    if (!formPrice.trim()) return;
    if (!formIsin.trim() && !formTicker.trim()) return;
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
    } catch {
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
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Price Alerts</h1>
        <Button size="sm" onClick={() => setAddModalOpen(true)}>
          <Plus size={14} className="mr-1" />
          New Alert
        </Button>
      </div>

      <Card padding={false}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={28} />
          </div>
        ) : alerts.length === 0 ? (
          <div className="text-center py-16">
            <Bell size={32} className="mx-auto text-text-secondary mb-3" />
            <p className="text-sm text-text-secondary">No price alerts</p>
            <p className="text-xs text-text-secondary mt-1">
              Set alerts to get notified when a security reaches your target price
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {alerts.map((alert: any) => (
              <div
                key={alert.id}
                className="flex items-center justify-between px-5 py-4 hover:bg-bg-card-hover transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-accent-dim flex items-center justify-center">
                    <Bell size={16} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {alert.name || alert.isin || alert.ticker}
                    </p>
                    <p className="text-xs text-text-secondary">
                      Target: {alert.targetPrice}
                      {alert.currentPrice && ` · Current: ${alert.currentPrice}`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(alert.id)}
                  className="p-1.5 rounded-lg text-text-secondary hover:text-negative hover:bg-negative/10 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal isOpen={addModalOpen} onClose={() => setAddModalOpen(false)} title="New Price Alert">
        <div className="space-y-4">
          <Input
            label="ISIN (or use Ticker below)"
            placeholder="e.g. US0378331005"
            value={formIsin}
            onChange={(e) => setFormIsin(e.target.value)}
          />
          <Input
            label="Crypto Ticker (alternative to ISIN)"
            placeholder="e.g. BTC"
            value={formTicker}
            onChange={(e) => setFormTicker(e.target.value)}
          />
          <Input
            label="Target Price"
            type="number"
            placeholder="e.g. 180.00"
            value={formPrice}
            onChange={(e) => setFormPrice(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd}>Create Alert</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
