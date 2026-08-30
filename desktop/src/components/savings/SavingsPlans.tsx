import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Modal from "../ui/Modal";
import { formatCurrency } from "../../lib/format";
import { PiggyBank, Plus, Trash2, Settings } from "lucide-react";

export default function SavingsPlans() {
  const { activePortfolioId } = useAppStore();
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [formIsin, setFormIsin] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formFrequency, setFormFrequency] = useState("MONTHLY");

  const loadPlans = async () => {
    setLoading(true);
    try {
      const data = await api.getSavingsPlans(activePortfolioId || undefined);
      setPlans((data as any).plans || []);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, [activePortfolioId]);

  const handleCreate = async () => {
    if (!formIsin.trim() || !formAmount.trim()) return;
    try {
      await api.addSavingsPlan({
        isin: formIsin.trim(),
        amount: formAmount.trim(),
        frequency: formFrequency,
        portfolioId: activePortfolioId || undefined,
      });
      setFormIsin("");
      setFormAmount("");
      setCreateModalOpen(false);
      loadPlans();
    } catch {
    }
  };

  const handleRemove = async (isin: string) => {
    try {
      await api.removeSavingsPlan(isin, activePortfolioId || undefined);
      loadPlans();
    } catch {
    }
  };

  const frequencies = [
    { value: "MONTHLY", label: "Monthly" },
    { value: "BI_MONTHLY", label: "Bi-Monthly" },
    { value: "QUARTERLY", label: "Quarterly" },
    { value: "SEMI_ANNUALLY", label: "Semi-Annually" },
    { value: "ANNUALLY", label: "Annually" },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Savings Plans</h1>
        <Button size="sm" onClick={() => setCreateModalOpen(true)}>
          <Plus size={14} className="mr-1" />
          New Plan
        </Button>
      </div>

      <Card padding={false}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={28} />
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-16">
            <PiggyBank size={32} className="mx-auto text-text-secondary mb-3" />
            <p className="text-sm text-text-secondary">No savings plans</p>
            <p className="text-xs text-text-secondary mt-1">
              Set up automatic recurring investments
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {plans.map((plan: any) => (
              <div
                key={plan.isin}
                className="flex items-center justify-between px-5 py-4 hover:bg-bg-card-hover transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-accent-dim flex items-center justify-center">
                    <PiggyBank size={16} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {plan.name || plan.isin}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {formatCurrency(parseFloat(plan.amount || "0"))} · {plan.frequency || "Monthly"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    {plan.nextExecution && (
                      <p className="text-xs text-text-secondary">
                        Next: {new Date(plan.nextExecution).toLocaleDateString("de-DE")}
                      </p>
                    )}
                    <p className={`text-xs font-medium ${plan.status === "active" ? "text-positive" : "text-text-secondary"}`}>
                      {plan.status || "Active"}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemove(plan.isin)}
                    className="p-1.5 rounded-lg text-text-secondary hover:text-negative hover:bg-negative/10 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="New Savings Plan">
        <div className="space-y-4">
          <Input
            label="ISIN"
            placeholder="e.g. US0378331005"
            value={formIsin}
            onChange={(e) => setFormIsin(e.target.value)}
          />
          <Input
            label="Amount (EUR)"
            type="number"
            placeholder="e.g. 100"
            value={formAmount}
            onChange={(e) => setFormAmount(e.target.value)}
          />
          <Select
            label="Frequency"
            options={frequencies}
            value={formFrequency}
            onChange={(e) => setFormFrequency(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>Create Plan</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
