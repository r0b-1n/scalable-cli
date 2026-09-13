import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, Bell, Lock, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { enumLabel, useI18n } from "../../i18n";
import { useToast } from "../ui/Toast";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency, formatDateTime } from "../../lib/format";
import type { PriceAlert } from "../../api/types";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Spinner from "../ui/Spinner";
import Modal from "../ui/Modal";
import Badge from "../ui/Badge";
import SegmentedControl from "../ui/SegmentedControl";
import DataTable, { type Column } from "../ui/DataTable";
import EmptyState from "../ui/EmptyState";
import ConfirmDialog from "../ui/ConfirmDialog";
import CliCommand from "../ui/CliCommand";

type AlertMode = "isin" | "ticker";

export default function PriceAlerts() {
  const navigate = useNavigate();
  const { activePortfolioId, refreshToken } = useAppStore();
  const { t } = useI18n();
  const { push } = useToast();

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [mode, setMode] = useState<AlertMode>("isin");
  const [formIsin, setFormIsin] = useState("");
  const [formTicker, setFormTicker] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [removeAlert, setRemoveAlert] = useState<PriceAlert | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getPriceAlerts(activePortfolioId || undefined, activeOnly);
      setAlerts(data.result.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [activePortfolioId, activeOnly, t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const closeAdd = () => {
    setAddOpen(false);
    setFormIsin("");
    setFormTicker("");
    setFormPrice("");
    setFormError(null);
    setMode("isin");
  };

  const priceNum = parseFloat(formPrice);
  const canSubmit =
    Number.isFinite(priceNum) &&
    priceNum > 0 &&
    (mode === "isin" ? formIsin.trim().length > 0 : formTicker.trim().length > 0);

  const submitArgs = {
    isin: mode === "isin" ? formIsin.trim().toUpperCase() || undefined : undefined,
    ticker: mode === "ticker" ? formTicker.trim().toUpperCase() || undefined : undefined,
    price: formPrice.trim(),
    portfolioId: activePortfolioId || undefined,
  };

  const handleAdd = async () => {
    if (adding || !canSubmit) return;
    setAdding(true);
    setFormError(null);
    try {
      await api.addPriceAlert(submitArgs);
      push({ tone: "success", title: t.alerts.createAlert });
      closeAdd();
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t.common.actionFailed);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveConfirmed = async () => {
    if (!removeAlert) return;
    setRemoving(true);
    try {
      await api.removePriceAlert(removeAlert.alert_id, activePortfolioId || undefined);
      push({ tone: "success", title: t.common.removed });
      setRemoveAlert(null);
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

  const columns = useMemo<Column<PriceAlert>[]>(
    () => [
      {
        key: "instrument",
        header: t.trade.rowSecurity,
        sortValue: (a) => a.name || a.isin || a.ticker || "",
        exportValue: (a) => a.isin || a.ticker || a.name,
        cell: (a) => (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-dim">
              <Bell size={15} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">{a.name || a.isin || a.ticker || "—"}</p>
              <p className="text-2xs text-text-tertiary">{a.isin ?? a.ticker ?? "—"}</p>
            </div>
          </div>
        ),
      },
      {
        key: "type",
        header: t.transactions.colType,
        hideNarrow: true,
        sortValue: (a) => a.security_type,
        exportValue: (a) => enumLabel(t.common.securityTypes, a.security_type),
        cell: (a) => <Badge>{enumLabel(t.common.securityTypes, a.security_type)}</Badge>,
      },
      {
        key: "target",
        header: t.alerts.targetPrice,
        align: "right",
        sortValue: (a) => parseFloat(a.price || "0"),
        exportValue: (a) => `${enumLabel(t.alerts.directions, a.direction)} ${a.price}`,
        cell: (a) => {
          const above = String(a.direction).toUpperCase() === "ABOVE";
          return (
            <span
              className="inline-flex items-center justify-end gap-1.5"
              title={enumLabel(t.alerts.directions, a.direction)}
            >
              {above ? (
                <ArrowUp size={12} className="text-positive" />
              ) : (
                <ArrowDown size={12} className="text-negative" />
              )}
              {formatCurrency(parseFloat(a.price || "0"))}
            </span>
          );
        },
      },
      {
        key: "status",
        header: t.transactions.colStatus,
        sortValue: (a) => (a.triggered_timestamp_utc ? 2 : a.is_active ? 1 : 0),
        exportValue: (a) => (a.triggered_timestamp_utc ? t.alerts.triggered : a.is_active ? t.alerts.active : t.alerts.inactive),
        cell: (a) => (
          <div className="space-y-1">
            <Badge variant={a.triggered_timestamp_utc ? "warning" : a.is_active ? "positive" : "default"}>
              {a.triggered_timestamp_utc ? t.alerts.triggered : a.is_active ? t.alerts.active : t.alerts.inactive}
            </Badge>
            {a.triggered_timestamp_utc && (
              <p className="text-2xs text-text-tertiary tabular-nums">{formatDateTime(a.triggered_timestamp_utc)}</p>
            )}
          </div>
        ),
      },
      {
        key: "limit",
        header: "",
        hideNarrow: true,
        cell: (a) =>
          !a.can_add_new_for_instrument ? (
            <span title={t.groups.limitReached} aria-label={t.groups.limitReached}>
              <Lock size={13} className="text-text-tertiary" />
            </span>
          ) : null,
      },
      {
        key: "actions",
        header: "",
        align: "right",
        cell: (a) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRemoveAlert(a);
            }}
            aria-label={t.alerts.removeAria}
            title={t.alerts.removeAria}
            className="cursor-pointer rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-negative/10 hover:text-negative"
          >
            <Trash2 size={14} />
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  const cliCommand = renderCliCommand("get_price_alerts", {
    portfolioId: activePortfolioId || undefined,
    activeOnly,
  });

  if (error && alerts.length === 0) {
    return (
      <div className="space-y-8">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.alerts.title}</h1>
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
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.alerts.title}</h1>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          {t.alerts.newAlert}
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={alerts}
        rowKey={(a) => a.alert_id}
        onRowClick={(a) => a.isin && navigate(`/security/${a.isin}`)}
        loading={loading}
        exportName="price-alerts"
        empty={
          <EmptyState
            icon={<Bell size={20} />}
            title={t.alerts.emptyTitle}
            description={t.alerts.emptyDesc}
            action={
              <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
                {t.alerts.newAlert}
              </Button>
            }
          />
        }
        toolbar={
          <button
            onClick={() => setActiveOnly((v) => !v)}
            aria-pressed={activeOnly}
            className={`cursor-pointer rounded-full px-3 py-1 text-2xs font-medium transition-colors ${
              activeOnly ? "bg-accent-dim text-accent" : "bg-hover text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.alerts.active}
          </button>
        }
      />

      <CliCommand commands={cliCommand} variant="block" />

      <Modal isOpen={addOpen} onClose={closeAdd} title={t.alerts.modalTitle}>
        <div className="space-y-4">
          <SegmentedControl<AlertMode>
            options={[
              { value: "isin", label: t.watchlist.isinLabel },
              { value: "ticker", label: t.common.securityTypes.CRYPTO },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === "isin" ? (
            <Input
              label={t.alerts.isinLabel}
              placeholder={t.watchlist.isinPlaceholder}
              value={formIsin}
              onChange={(e) => setFormIsin(e.target.value)}
            />
          ) : (
            <Input
              label={t.alerts.tickerLabel}
              placeholder={t.alerts.tickerPlaceholder}
              value={formTicker}
              onChange={(e) => setFormTicker(e.target.value)}
            />
          )}
          <Input
            label={t.alerts.targetPrice}
            type="number"
            min="0"
            step="0.01"
            placeholder={t.alerts.pricePlaceholder}
            value={formPrice}
            onChange={(e) => setFormPrice(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          {formError && (
            <div className="rounded-lg border border-negative/20 bg-negative/10 p-3">
              <p className="text-xs text-negative">{formError}</p>
            </div>
          )}
          <CliCommand commands={renderCliCommand("add_price_alert", submitArgs)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeAdd}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleAdd} disabled={adding || !canSubmit}>
              {adding ? <Spinner size={16} className="mr-2" /> : null}
              {t.alerts.createAlert}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeAlert)}
        onClose={() => setRemoveAlert(null)}
        onConfirm={handleRemoveConfirmed}
        title={t.alerts.removeAria}
        description={removeAlert?.name || removeAlert?.isin || removeAlert?.ticker || undefined}
        confirmLabel={t.groups.unassign}
        cancelLabel={t.common.cancel}
        tone="danger"
        busy={removing}
      />
    </div>
  );
}
