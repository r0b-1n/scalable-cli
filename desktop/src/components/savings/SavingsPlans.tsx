import { useCallback, useEffect, useState } from "react";
import { PiggyBank, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useToast } from "../ui/Toast";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import DataTable, { type Column } from "../ui/DataTable";
import EmptyState from "../ui/EmptyState";
import ConfirmDialog from "../ui/ConfirmDialog";
import CliCommand from "../ui/CliCommand";
import Tabs from "../ui/Tabs";
import { SkeletonLines } from "../ui/Skeleton";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency, formatDate } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import type { SavingsPlan } from "../../api/types";
import { frequencyKey } from "./savingsData";
import SavingsPlanModal from "./SavingsPlanModal";
import SavingsPlanSimulator from "./SavingsPlanSimulator";
import ContributedVsValue from "./ContributedVsValue";

type Tab = "plans" | "simulator" | "contributed";

/** `rate` is a decimal fraction string, same convention as `interest_rate`. */
function ratePercent(rate: string): string {
  const n = parseFloat(rate);
  return Number.isFinite(n) ? `${(n * 100).toFixed(n * 100 % 1 === 0 ? 0 : 2)}%` : rate;
}

export default function SavingsPlans() {
  const { activePortfolioId, refreshToken } = useAppStore();
  const { t } = useI18n();
  const { push } = useToast();

  const [tab, setTab] = useState<Tab>("plans");
  const [plans, setPlans] = useState<SavingsPlan[]>([]);
  const [stats, setStats] = useState({ count: 0, cryptoCount: 0, nonCryptoCount: 0, totalAmount: "0" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SavingsPlan | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SavingsPlan | null>(null);
  const [removing, setRemoving] = useState(false);

  const portfolioId = activePortfolioId || undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSavingsPlans(portfolioId);
      setPlans(data.result.items ?? []);
      setStats({
        count: data.result.count ?? 0,
        cryptoCount: data.result.crypto_count ?? 0,
        nonCryptoCount: data.result.non_crypto_count ?? 0,
        totalAmount: data.result.total_savings_plan_amount ?? "0",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [portfolioId, t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const openCreate = () => {
    setEditingPlan(null);
    setModalOpen(true);
  };
  const openEdit = (plan: SavingsPlan) => {
    setEditingPlan(plan);
    setModalOpen(true);
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.removeSavingsPlan(removeTarget.isin, portfolioId);
      push({ tone: "success", title: t.common.removed });
      setRemoveTarget(null);
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

  const columns: Column<SavingsPlan>[] = [
    {
      key: "security",
      header: t.portfolio.colSecurity,
      cell: (p) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-dim">
            <PiggyBank size={14} className="text-accent" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text-primary">{p.name || p.isin}</p>
            <p className="text-2xs text-text-tertiary">{p.isin}</p>
          </div>
        </div>
      ),
      sortValue: (p) => p.name || p.isin,
      exportValue: (p) => `${p.name} (${p.isin})`,
    },
    {
      key: "amount",
      header: t.savings.amountLabel,
      align: "right",
      cell: (p) => <span className="font-medium">{formatCurrency(parseFloat(p.amount || "0"))}</span>,
      sortValue: (p) => parseFloat(p.amount || "0"),
      exportValue: (p) => p.amount,
    },
    {
      key: "frequency",
      header: t.savings.frequencyLabel,
      cell: (p) => <Badge>{enumLabel(t.savings.frequencies, frequencyKey(p.frequency || ""))}</Badge>,
      sortValue: (p) => p.frequency ?? "",
    },
    {
      key: "dayOfMonth",
      header: t.savings.dayOfMonthLabel,
      align: "right",
      hideNarrow: true,
      cell: (p) => p.day_of_month,
      sortValue: (p) => p.day_of_month,
    },
    {
      key: "dynamizationRate",
      header: t.savings.dynamizationLabel,
      align: "right",
      hideNarrow: true,
      cell: (p) => ratePercent(p.dynamization_rate || "0"),
      sortValue: (p) => parseFloat(p.dynamization_rate || "0"),
    },
    {
      key: "paymentMethod",
      header: t.savings.paymentMethodLabel,
      hideNarrow: true,
      cell: (p) => enumLabel(t.savings.paymentMethods, p.payment_method),
      sortValue: (p) => p.payment_method ?? "",
    },
    {
      key: "next",
      header: t.savings.nextExecutionLabel,
      align: "right",
      cell: (p) => (p.next_execution_date ? formatDate(p.next_execution_date) : "—"),
      sortValue: (p) => p.next_execution_epoch_day ?? 0,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(p);
            }}
            className="cursor-pointer rounded-full p-1.5 text-text-tertiary transition-colors hover:bg-hover hover:text-text-primary"
            aria-label={t.savings.editAria(p.isin)}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRemoveTarget(p);
            }}
            className="cursor-pointer rounded-full p-1.5 text-text-tertiary transition-colors hover:bg-negative/10 hover:text-negative"
            aria-label={t.savings.removeAria(p.isin)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  const cliCommand = renderCliCommand("get_savings_plans", { portfolioId });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.savings.title}</h1>
        <Button size="sm" onClick={openCreate}>
          <Plus size={14} className="mr-1.5" />
          {t.savings.newPlan}
        </Button>
      </div>

      {loading ? (
        <SkeletonLines rows={2} />
      ) : (
        <section className="grid grid-cols-2 divide-x divide-border border-b border-border pb-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-text-secondary">{t.savings.title}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
              {formatCurrency(parseFloat(stats.totalAmount || "0"))}
            </p>
          </div>
          <div className="pl-6">
            <p className="text-xs text-text-secondary">{t.portfolio.holdingsCount}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
              {stats.count}
            </p>
          </div>
          <div className="pl-6">
            <p className="text-xs text-text-secondary">{t.common.securityTypes.CRYPTO}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
              {stats.cryptoCount}
            </p>
          </div>
          <div className="pl-6">
            <p className="text-xs text-text-secondary">{t.common.securityTypes.STOCK}/{t.common.securityTypes.ETF}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
              {stats.nonCryptoCount}
            </p>
          </div>
        </section>
      )}

      <Tabs<Tab>
        items={[
          { value: "plans", label: t.savings.plansTab },
          { value: "simulator", label: t.savings.simulatorTab },
          { value: "contributed", label: t.savings.contributedTab },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "plans" && (
        <>
          {error && plans.length === 0 && !loading ? (
            <div className="space-y-4 py-16 text-center">
              <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{error}</p>
              <Button variant="secondary" onClick={load}>
                {t.common.retry}
              </Button>
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={plans}
              rowKey={(p) => p.isin}
              loading={loading}
              exportName="savings-plans"
              initialSort={{ key: "amount", direction: "desc" }}
              empty={
                <EmptyState
                  icon={<PiggyBank size={20} />}
                  title={t.savings.emptyTitle}
                  description={t.savings.emptyDesc}
                  action={
                    <Button size="sm" variant="secondary" onClick={openCreate}>
                      <Plus size={14} className="mr-1.5" />
                      {t.savings.newPlan}
                    </Button>
                  }
                />
              }
            />
          )}
          <CliCommand commands={cliCommand} variant="block" />
        </>
      )}

      {tab === "simulator" && <SavingsPlanSimulator portfolioId={portfolioId} />}
      {tab === "contributed" && <ContributedVsValue portfolioId={portfolioId} />}

      <SavingsPlanModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
        portfolioId={portfolioId}
        editingPlan={editingPlan}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        title={removeTarget ? t.savings.removeAria(removeTarget.isin) : ""}
        confirmLabel={t.groups.unassign}
        cancelLabel={t.common.cancel}
        tone="danger"
        busy={removing}
      />
    </div>
  );
}
