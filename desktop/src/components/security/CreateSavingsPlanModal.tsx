import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import { enumLabel, useI18n } from "../../i18n";
import { useToast } from "../ui/Toast";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency } from "../../lib/format";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Spinner from "../ui/Spinner";
import Card, { CardTitle } from "../ui/Card";
import CliCommand from "../ui/CliCommand";
import { SkeletonLines } from "../ui/Skeleton";
import type {
  SavingsPlanConfigData,
  SavingsPlanFrequency,
  SavingsPlanPaymentMethod,
  SavingsPlanPreviewData,
} from "../../api/types";

interface CreateSavingsPlanModalProps {
  open: boolean;
  onClose: () => void;
  isin: string;
  name?: string | null;
  portfolioId?: string;
  onCreated?: () => void;
}

type PreviewResult = SavingsPlanPreviewData["result"];

/** Renders one disclosure/config value exactly as the CLI returned it — no
 * rounding, no re-labelling. `nullAsLiteral` mirrors
 * `compliance.presentation.display_null_as_literal`. */
function formatValue(value: unknown, nullAsLiteral: boolean): ReactNode {
  if (value === null || value === undefined) {
    return nullAsLiteral ? (
      <span className="font-mono text-text-secondary">null</span>
    ) : (
      <span className="text-text-tertiary">—</span>
    );
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-text-tertiary">—</span>;
    return (
      <div className="space-y-1 text-right">
        {value.map((item, i) => (
          <div key={i}>{formatValue(item, nullAsLiteral)}</div>
        ))}
      </div>
    );
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.url === "string") {
    const label = typeof obj.label === "string" && obj.label ? obj.label : obj.url;
    return (
      <a
        href={obj.url}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {label}
      </a>
    );
  }
  return (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all text-left font-mono text-2xs text-text-secondary">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * Create-savings-plan flow for one security, two-phase like the trade
 * ticket: `add_savings_plan` without `confirm` only previews and returns the
 * full ex-ante disclosure; every section is rendered here, in order, before
 * a separate explicit button repeats the call with `confirm`.
 */
export default function CreateSavingsPlanModal({
  open,
  onClose,
  isin,
  name,
  portfolioId,
  onCreated,
}: CreateSavingsPlanModalProps) {
  const { t } = useI18n();
  const { push } = useToast();

  const [config, setConfig] = useState<SavingsPlanConfigData["result"] | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState<number | null>(null);
  const [dynamizationRate, setDynamizationRate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setPreview(null);
    setError(null);
    setConfigLoading(true);
    setConfigError(null);
    api
      .getSavingsPlanConfig(isin, portfolioId)
      .then((data) => {
        const cfg = data.result;
        setConfig(cfg);
        setFrequency(cfg.defaults.frequency);
        setDayOfMonth(cfg.defaults.day_of_month);
        setDynamizationRate(cfg.defaults.dynamization_rate);
        setPaymentMethod(cfg.defaults.payment_method);
      })
      .catch((err) => setConfigError(err instanceof Error ? err.message : t.common.loadFailed))
      .finally(() => setConfigLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isin, portfolioId]);

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const amountNum = parseFloat(amount);
  const minAmount = config ? parseFloat(config.amount_limits.min) : 0;
  const maxAmount = config ? parseFloat(config.amount_limits.max) : Infinity;
  const canSubmit =
    Boolean(config) &&
    Number.isFinite(amountNum) &&
    amountNum >= minAmount &&
    amountNum <= maxAmount &&
    frequency.length > 0;

  // `frequency`/`paymentMethod` come straight from `get_savings_plan_config`'s
  // own CLI-spelled option lists, so they always match the literal unions the
  // CLI accepts back — the cast just satisfies the stricter param types.
  const buildArgs = (confirm?: string) => ({
    isin,
    amount: amount.trim(),
    frequency: (frequency || undefined) as SavingsPlanFrequency | undefined,
    dayOfMonth: dayOfMonth ?? undefined,
    yearMonth: config?.defaults.year_month,
    dynamizationRate: dynamizationRate || undefined,
    paymentMethod: (paymentMethod || undefined) as SavingsPlanPaymentMethod | undefined,
    portfolioId,
    confirm,
  });

  const handlePreview = async () => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await api.addSavingsPlan(buildArgs());
      const r = data.result;
      if (!r.confirmation?.id) {
        setError(t.savings.createFailed);
        return;
      }
      setPreview(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.savings.createFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (submitting || !preview) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.addSavingsPlan(buildArgs(preview.confirmation.id));
      push({ tone: "success", title: t.savings.createPlan, description: name || isin });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.savings.createFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const frequencyOptions = (config?.frequencies ?? []).map((f) => ({
    value: f,
    label: enumLabel(t.savings.frequencies, f.toUpperCase().replace(/-/g, "_")),
  }));

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title={preview ? t.savings.confirmTitle : t.savings.modalTitle}
      maxWidth="max-w-lg"
    >
      {configLoading ? (
        <SkeletonLines rows={4} />
      ) : configError ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-text-secondary">{configError}</p>
          <Button variant="secondary" onClick={close}>
            {t.common.cancel}
          </Button>
        </div>
      ) : preview ? (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">{t.savings.confirmBody}</p>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {preview.presentation.section_order.map((key) => {
              const section = preview.presentation.sections[key];
              if (!section) return null;
              return (
                <Card key={key}>
                  <CardTitle className="mb-2.5">{section.title}</CardTitle>
                  <div className="divide-y divide-border">
                    {section.fields.map((field) => (
                      <div
                        key={field.path}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2"
                      >
                        <span className="text-sm text-text-secondary">{field.label}</span>
                        <span className="text-right text-sm font-medium tabular-nums text-text-primary">
                          {formatValue(field.value, Boolean(preview.compliance.presentation.display_null_as_literal))}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
          {error && (
            <div className="rounded-lg border border-negative/20 bg-negative/10 p-3">
              <p className="whitespace-pre-line text-xs text-negative">{error}</p>
            </div>
          )}
          <CliCommand
            commands={[
              renderCliCommand("add_savings_plan", buildArgs()),
              renderCliCommand("add_savings_plan", buildArgs(preview.confirmation.id)),
            ]}
            variant="block"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={submitting}>
              {t.common.previous}
            </Button>
            <Button onClick={handleConfirm} disabled={submitting}>
              {submitting ? <Spinner size={16} className="mr-2" /> : null}
              {t.savings.confirmCreate}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-text-primary">{name || isin}</p>
            <p className="text-2xs text-text-tertiary">{isin}</p>
          </div>
          <div>
            <Input
              label={t.savings.amountLabel}
              type="number"
              placeholder={t.savings.amountPlaceholder}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {config && (
              <p className="mt-1 text-2xs text-text-tertiary">
                {formatCurrency(minAmount)} – {formatCurrency(maxAmount)}
              </p>
            )}
          </div>
          <Select
            label={t.savings.frequencyLabel}
            options={frequencyOptions}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
          />
          {error && (
            <div className="rounded-lg border border-negative/20 bg-negative/10 p-3">
              <p className="text-xs text-negative">{error}</p>
            </div>
          )}
          <CliCommand commands={renderCliCommand("add_savings_plan", buildArgs())} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {t.common.cancel}
            </Button>
            <Button onClick={handlePreview} disabled={submitting || !canSubmit}>
              {submitting ? <Spinner size={16} className="mr-2" /> : null}
              {t.savings.createPlan}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
