import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Modal from "../ui/Modal";
import { formatCurrency, formatPercent } from "../../lib/format";
import { Star, Plus, Trash2 } from "lucide-react";

export default function Watchlist() {
  const navigate = useNavigate();
  const { activePortfolioId } = useAppStore();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newIsin, setNewIsin] = useState("");

  const loadWatchlist = async () => {
    setLoading(true);
    try {
      const data = await api.getWatchlist(activePortfolioId || undefined);
      setItems((data as any).items || []);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWatchlist();
  }, [activePortfolioId]);

  const handleAdd = async () => {
    if (!newIsin.trim()) return;
    try {
      await api.addToWatchlist(newIsin.trim(), activePortfolioId || undefined);
      setNewIsin("");
      setAddModalOpen(false);
      loadWatchlist();
    } catch {
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
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Watchlist</h1>
        <Button size="sm" onClick={() => setAddModalOpen(true)}>
          <Plus size={14} className="mr-1" />
          Add to Watchlist
        </Button>
      </div>

      <Card padding={false}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={28} />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <Star size={32} className="mx-auto text-text-secondary mb-3" />
            <p className="text-sm text-text-secondary">Your watchlist is empty</p>
            <p className="text-xs text-text-secondary mt-1">
              Add securities to track them here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {items.map((item: any) => {
              const ret = parseFloat(item.dayChangePercent || "0");
              return (
                <div
                  key={item.isin}
                  className="flex items-center justify-between px-5 py-4 hover:bg-bg-card-hover transition-colors"
                >
                  <div
                    className="flex items-center gap-3 cursor-pointer flex-1"
                    onClick={() => navigate(`/security/${item.isin}`)}
                  >
                    <div className="w-9 h-9 rounded-full bg-bg-primary flex items-center justify-center text-xs font-bold text-text-secondary">
                      {(item.name || item.isin).charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        {item.name || item.isin}
                      </p>
                      <p className="text-xs text-text-secondary">{item.isin}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-medium text-text-primary">
                        {item.price ? formatCurrency(parseFloat(item.price)) : "—"}
                      </p>
                      {item.dayChangePercent && (
                        <p className={`text-xs font-medium ${ret >= 0 ? "text-positive" : "text-negative"}`}>
                          {formatPercent(ret)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(item.isin);
                      }}
                      className="p-1.5 rounded-lg text-text-secondary hover:text-negative hover:bg-negative/10 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal isOpen={addModalOpen} onClose={() => setAddModalOpen(false)} title="Add to Watchlist">
        <div className="space-y-4">
          <Input
            label="ISIN"
            placeholder="e.g. US0378331005"
            value={newIsin}
            onChange={(e) => setNewIsin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd}>Add</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
