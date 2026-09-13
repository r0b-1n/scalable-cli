import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../ui/Toast";
import Modal from "../ui/Modal";
import { useI18n } from "../../i18n";
import type { SavingsPlan, SavingsPlanPreviewData } from "../../api/types";
import SavingsPlanEntryForm, { type SavingsPlanConfig } from "./SavingsPlanEntryForm";
import SavingsPlanDisclosure from "./SavingsPlanDisclosure";
import { ISIN_PATTERN } from "./savingsData";

type Step = "entry" | "disclosure";
type PreviewArgs = Parameters<typeof api.addSavingsPlan>[0];

interface SavingsPlanModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  portfolioId?: string;
  /** Present when editing an existing plan — ISIN is then locked. */
  editingPlan: SavingsPlan | null;
}

/**
 * Savings-plan ticket. Two explicit steps mirroring the CLI's own two-phase
 * `add_savings_plan` flow (§4 of the build spec):
 *  1. entry       — config-aware form, driven entirely by `get_savings_plan_config`.
 *  2. disclosure  — the full ex-ante disclosure from phase 1; phase 2 only
 *     ever runs from the explicit button `SavingsPlanDisclosure` renders.
 */
export default function SavingsPlanModal({
  open,
  onClose,
  onSaved,
  portfolioId,
  editingPlan,
}: SavingsPlanModalProps) {
  const { t } = useI18n();
  const { push } = useToast();

  const [step, setStep] = useState<Step>("entry");
  const [isin, setIsin] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState<number | null>(null);
  const [yearMonth, setYearMonth] = useState("");
  const [dynamizationRate, setDynamizationRate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");

  const [config, setConfig] = useState<SavingsPlanConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SavingsPlanPreviewData | null>(null);
  const [previewArgs, setPreviewArgs] = useState<PreviewArgs | null>(null);
  const [acceptUnsuitable, setAcceptUnsuitable] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const inFlight = useRef(false);

  const resetForm = useCallback(() => {
    setStep("entry");
    setIsin(editingPlan?.isin || "");
    setAmount(editingPlan?.amount || "");
    setFrequency(editingPlan?.frequency || "");
    setDayOfMonth(editingPlan?.day_of_month ?? null);
    setYearMonth("");
    setDynamizationRate(editingPlan?.dynamization_rate || "");
    setPaymentMethod(editingPlan?.payment_method || "");
    setConfig(null);
    setConfigLoading(false);
    setConfigError(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setPreview(null);
    setPreviewArgs(null);
    setAcceptUnsuitable(false);
    setConfirming(false);
    setConfirmError(null);
  }, [editingPlan]);

  useEffect(() => {
    if (open) resetForm();
  }, [open, resetForm]);

  // Config-aware form: fetch `get_savings_plan_config` whenever a valid ISIN
  // is present, and never offer a value it does not list.
  useEffect(() => {
    const clean = isin.trim().toUpperCase();
    if (!open || !ISIN_PATTERN.test(clean)) {
      setConfig(null);
      return;
    }
    let cancelled = false;
    setConfigLoading(true);
    setConfigError(null);
    const timer = setTimeout(async () => {
      try {
        const data = await api.getSavingsPlanConfig(clean, portfolioId);
        if (cancelled) return;
        const result = data.result;
        setConfig(result);
        // Pre-fill from defaults, but keep an edited plan's own values where
        // the config still allows them.
        setFrequency((f) => (f && result.frequencies.includes(f) ? f : result.defaults.frequency));
        setDayOfMonth((d) =>
          d != null && result.schedules.some((s) => s.day_of_month === d)
            ? d
            : result.defaults.day_of_month
        );
        setDynamizationRate((r) =>
          r && result.dynamization_rates.includes(r) ? r : result.defaults.dynamization_rate
        );
        setPaymentMethod((m) =>
          m && result.payment_methods.includes(m) ? m : result.defaults.payment_method
        );
        setYearMonth(result.defaults.year_month);
        setAmount((a) => a || "");
      } catch (err) {
        if (!cancelled) {
          setConfig(null);
          setConfigError(err instanceof Error ? err.message : t.savings.createFailed);
        }
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isin, open, portfolioId]);

  // The set of allowed first-execution months depends on the chosen day of
  // month (`config.schedules`); if switching the day leaves the current
  // `yearMonth` unlisted, snap to that schedule's own default so the form
  // never holds a combination the config does not offer.
  useEffect(() => {
    if (!config) return;
    const schedule = config.schedules.find((s) => s.day_of_month === dayOfMonth);
    if (schedule && !schedule.available_year_months.includes(yearMonth)) {
      setYearMonth(schedule.available_year_months[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOfMonth, config]);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const buildArgs = (): PreviewArgs => ({
    isin: isin.trim().toUpperCase(),
    amount: amount.trim(),
    frequency: (frequency || undefined) as PreviewArgs["frequency"],
    dayOfMonth: dayOfMonth ?? undefined,
    yearMonth: yearMonth || undefined,
    dynamizationRate: dynamizationRate || undefined,
    paymentMethod: (paymentMethod || undefined) as PreviewArgs["paymentMethod"],
    portfolioId,
  });

  const canPreview =
    Boolean(config) &&
    isin.trim().length > 0 &&
    amount.trim().length > 0 &&
    !Number.isNaN(parseFloat(amount));

  const handlePreview = async () => {
    if (inFlight.current || !canPreview) return;
    inFlight.current = true;
    setPreviewLoading(true);
    setPreviewError(null);
    const args = buildArgs();
    try {
      const data = await api.addSavingsPlan(args);
      const id = data.result?.confirmation?.id;
      if (!id) {
        setPreviewError(t.savings.createFailed);
        return;
      }
      setPreview(data);
      setPreviewArgs(args);
      setAcceptUnsuitable(false);
      setStep("disclosure");
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : t.savings.createFailed);
    } finally {
      inFlight.current = false;
      setPreviewLoading(false);
    }
  };

  // Phase 2 — fires only from the explicit button `SavingsPlanDisclosure`
  // renders, repeating the exact phase-1 arguments plus `confirm`.
  const handleConfirm = async () => {
    if (inFlight.current || !preview || !previewArgs) return;
    inFlight.current = true;
    setConfirming(true);
    setConfirmError(null);
    try {
      const confirmation = preview.result.confirmation;
      await api.addSavingsPlan({
        ...previewArgs,
        confirm: confirmation.id,
        ...(confirmation.requires_accept_unsuitable
          ? {
              acknowledgedAppropriatenessWarningVersion: confirmation.warning_version ?? undefined,
              appropriatenessId: confirmation.required_fields?.appropriateness_id ?? undefined,
            }
          : {}),
      });
      push({ tone: "success", title: t.common.saved });
      onSaved();
      handleClose();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : t.savings.createFailed);
    } finally {
      inFlight.current = false;
      setConfirming(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={handleClose}
      title={step === "entry" ? t.savings.modalTitle : t.savings.confirmTitle}
      maxWidth="max-w-2xl"
    >
      {step === "entry" && (
        <SavingsPlanEntryForm
          isin={isin}
          onIsinChange={setIsin}
          isinLocked={Boolean(editingPlan)}
          configLoading={configLoading}
          configError={configError}
          config={config}
          amount={amount}
          onAmountChange={setAmount}
          frequency={frequency}
          onFrequencyChange={setFrequency}
          dayOfMonth={dayOfMonth}
          onDayOfMonthChange={setDayOfMonth}
          yearMonth={yearMonth}
          onYearMonthChange={setYearMonth}
          dynamizationRate={dynamizationRate}
          onDynamizationRateChange={setDynamizationRate}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          previewArgs={buildArgs()}
          previewError={previewError}
          previewLoading={previewLoading}
          canPreview={canPreview}
          portfolioId={portfolioId}
          onPreview={handlePreview}
          onClose={handleClose}
        />
      )}

      {step === "disclosure" && preview && previewArgs && (
        <SavingsPlanDisclosure
          preview={preview}
          previewArgs={previewArgs}
          acceptUnsuitable={acceptUnsuitable}
          onAcceptUnsuitableChange={setAcceptUnsuitable}
          onBack={() => setStep("entry")}
          onConfirm={handleConfirm}
          confirming={confirming}
          error={confirmError}
        />
      )}
    </Modal>
  );
}
