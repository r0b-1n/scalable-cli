import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Modal from "../ui/Modal";
import EmptyState from "../ui/EmptyState";
import { formatCurrency, formatDate } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import { PiggyBank, Plus, Trash2 } from "lucide-react";

const FREQUENCY_VALUES = ["MONTHLY", "BI_MONTHLY", "QUARTERLY", "SEMI_ANNUALLY", "ANNUALLY"];

export default function SavingsPlans() {
  const { activePortfolioId } = useAppStore();
  const { t } = useI18n();

  const frequencyOptions = FREQUENCY_VALUES.map((v) => ({
    value: v,
    label: enumLabel(t.savings.frequencies, v),
  }));
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formIsin, setFormIsin] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formFrequency, setFormFrequency] = useState("MONTHLY");
  // sc's two-phase flow: `savings-plans add` returns a preview with a
  // confirmation id; the plan is only created when the same call is
  // repeated with --confirm <id>.
  const [confirmationId, setConfirmationId] = useState<string | null>(null);

  const loadPlans = async () => {
    setLoading(true);
    try {
      const data = await api.getSavingsPlans(activePortfolioId || undefined);
      // sc --json wraps the payload in {resolution, result: {items}}.
      setPlans((data as any)?.result?.items ?? []);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, [activePortfolioId]);

  const closeCreateModal = () => {
    setCreateModalOpen(false);
    setConfirmationId(null);
    setFormError(null);
  };

  const handleCreate = async () => {
    if (creating || !formIsin.trim() || !formAmount.trim()) return;
    setCreating(true);
    setFormError(null);
    try {
      const data = await api.addSavingsPlan({
        isin: formIsin.trim(),
        amount: formAmount.trim(),
        // API enum codes (MONTHLY, BI_MONTHLY, …) → CLI value-enum spelling.
        frequency: formFrequency.toLowerCase().replace(/_/g, "-"),
        portfolioId: activePortfolioId || undefined,
        confirm: confirmationId || undefined,
      });
      const result = (data as any)?.result;
      if (!confirmationId && result?.action === "preview") {
        const id = result?.confirmation?.id;
        if (!id) {
          setFormError(t.savings.createFailed);
          return;
        }
        setConfirmationId(id);
        return;
      }
      setFormIsin("");
      setFormAmount("");
      closeCreateModal();
      loadPlans();
    } catch (err: any) {
      setFormError(err?.message || t.savings.createFailed);
    } finally {
      setCreating(false);
    }
  };

  const handleRemove = async (isin: string) => {
    try {
      await api.removeSavingsPlan(isin, activePortfolioId || undefined);
      loadPlans();
    } catch {
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t.savings.title}</h1>
        <Button size="sm" onClick={() => setCreateModalOpen(true)}>
          <Plus size={14} className="mr-1.5" />
          {t.savings.newPlan}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : plans.length === 0 ? (
        <EmptyState
          icon={<PiggyBank size={20} />}
          title={t.savings.emptyTitle}
          description={t.savings.emptyDesc}
          action={
            <Button size="sm" variant="secondary" onClick={() => setCreateModalOpen(true)}>
              <Plus size={14} className="mr-1.5" />
              {t.savings.newPlan}
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-border">
          {plans.map((plan: any) => (
            <div
              key={plan.isin}
              className="group flex items-center justify-between px-2 -mx-2 py-3.5 rounded-lg hover:bg-bg-card-hover/60 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-accent-dim flex items-center justify-center shrink-0">
                  <PiggyBank size={15} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {plan.name || plan.isin}
                  </p>
                  <p className="text-2xs text-text-tertiary">
                    {formatCurrency(parseFloat(plan.amount || "0"))} ·{" "}
                    {enumLabel(t.savings.frequencies, plan.frequency || "MONTHLY")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {plan.next_execution_date && (
                  <p className="text-2xs text-text-tertiary tabular-nums">
                    {t.savings.nextExecution(formatDate(plan.next_execution_date))}
                  </p>
                )}
                <button
                  onClick={() => handleRemove(plan.isin)}
                  className="p-1.5 rounded-full text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-negative hover:bg-negative/10 transition-all cursor-pointer"
                  aria-label={t.savings.removeAria(plan.isin)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={createModalOpen}
        onClose={closeCreateModal}
        title={confirmationId ? t.savings.confirmTitle : t.savings.modalTitle}
      >
        {confirmationId ? (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">{t.savings.confirmBody}</p>
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-text-secondary">{t.watchlist.isinLabel}</span>
                <span className="text-sm font-medium text-text-primary tabular-nums">{formIsin.trim()}</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-text-secondary">{t.savings.amountLabel}</span>
                <span className="text-sm font-medium text-text-primary tabular-nums">
                  {formatCurrency(parseFloat(formAmount || "0"))}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-text-secondary">{t.savings.frequencyLabel}</span>
                <span className="text-sm font-medium text-text-primary">
                  {enumLabel(t.savings.frequencies, formFrequency)}
                </span>
              </div>
            </div>
            {formError && (
              <div className="p-3 bg-negative/10 border border-negative/20 rounded-lg">
                <p className="text-xs text-negative">{formError}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeCreateModal}>
                {t.common.cancel}
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? <Spinner size={16} className="mr-2" /> : null}
                {t.savings.confirmCreate}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              label={t.watchlist.isinLabel}
              placeholder={t.watchlist.isinPlaceholder}
              value={formIsin}
              onChange={(e) => setFormIsin(e.target.value)}
            />
            <Input
              label={t.savings.amountLabel}
              type="number"
              placeholder={t.savings.amountPlaceholder}
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
            />
            <Select
              label={t.savings.frequencyLabel}
              options={frequencyOptions}
              value={formFrequency}
              onChange={(e) => setFormFrequency(e.target.value)}
            />
            {formError && (
              <div className="p-3 bg-negative/10 border border-negative/20 rounded-lg">
                <p className="text-xs text-negative">{formError}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeCreateModal}>
                {t.common.cancel}
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {t.savings.createPlan}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
