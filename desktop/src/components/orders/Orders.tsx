import { useCallback, useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useToast } from "../ui/Toast";
import Tabs from "../ui/Tabs";
import DataTable from "../ui/DataTable";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import ConfirmDialog from "../ui/ConfirmDialog";
import CliCommand from "../ui/CliCommand";
import { renderCliCommand } from "../../lib/cliLog";
import { useI18n } from "../../i18n";
import { OPEN_ORDER_STATUSES, type Transaction } from "../../api/types";
import { useOrderColumns } from "./orderColumns";
import TransactionDetailModal from "../transactions/TransactionDetailModal";

type OrdersTab = "open" | "history";

/**
 * Open Orders & Cancel. Open uses the CLI's own notion of "still working"
 * (`OPEN_ORDER_STATUSES`); History is buy/sell executions. A row click opens
 * the full transaction detail; cancelling an open order goes through a
 * destructive confirmation, then refetches so the row reflects the real
 * post-cancel state rather than being removed optimistically.
 */
export default function Orders() {
  const { activePortfolioId, refreshToken } = useAppStore();
  const { t } = useI18n();
  const { push } = useToast();

  const [tab, setTab] = useState<OrdersTab>("open");
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<Transaction | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);

  const buildQueryParams = useCallback(
    () =>
      tab === "open"
        ? { portfolioId: activePortfolioId || undefined, status: [...OPEN_ORDER_STATUSES] }
        : { portfolioId: activePortfolioId || undefined, typeFilter: ["BUY", "SELL"] },
    [tab, activePortfolioId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTransactions(buildQueryParams());
      setItems(data.result.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [buildQueryParams, t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.tradeCancel(cancelTarget.id, activePortfolioId || undefined);
      push({ tone: "success", title: t.orders.cancelled });
      setCancelTarget(null);
      load();
    } catch (err) {
      push({
        tone: "error",
        title: t.orders.cancelFailed,
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCancelling(false);
    }
  };

  const columns = useOrderColumns({ t, showCancel: tab === "open", onCancel: setCancelTarget });
  const cliCommand = renderCliCommand("get_transactions", buildQueryParams());

  if (error && items.length === 0) {
    return (
      <div className="space-y-8">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.orders.title}</h1>
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
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.orders.title}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t.orders.subtitle}</p>
      </div>

      <Tabs<OrdersTab>
        items={[
          { value: "open", label: t.orders.open },
          { value: "history", label: t.orders.history },
        ]}
        value={tab}
        onChange={setTab}
      />

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(tx) => tx.id}
        onRowClick={(tx) => setDetailTx(tx)}
        loading={loading}
        exportName={tab === "open" ? "open-orders" : "order-history"}
        initialSort={{ key: "date", direction: "desc" }}
        empty={
          <EmptyState
            icon={<ClipboardList size={20} />}
            title={tab === "open" ? t.orders.noOpen : t.orders.noHistory}
            description={tab === "open" ? t.orders.noOpenHint : undefined}
          />
        }
      />

      <CliCommand commands={cliCommand} variant="block" />

      <ConfirmDialog
        open={cancelTarget != null}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancel}
        title={t.orders.cancel}
        description={
          <div className="space-y-1">
            <p>{t.orders.cancelConfirm}</p>
            <p className="text-text-tertiary">{t.orders.cancelConfirmBody}</p>
          </div>
        }
        confirmLabel={t.orders.cancel}
        cancelLabel={t.common.cancel}
        tone="danger"
        busy={cancelling}
      />

      <TransactionDetailModal
        transaction={detailTx}
        portfolioId={activePortfolioId || undefined}
        onClose={() => setDetailTx(null)}
      />
    </div>
  );
}
