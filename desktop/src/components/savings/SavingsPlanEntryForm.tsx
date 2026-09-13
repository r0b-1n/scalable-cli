import { useMemo } from "react";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";
import CliCommand from "../ui/CliCommand";
import { formatCurrency, formatDate, formatNumber } from "../../lib/format";
import { renderCliCommand } from "../../lib/cliLog";
import { enumLabel, useI18n } from "../../i18n";
import type { SavingsPlanConfigData } from "../../api/types";
import { frequencyKey } from "./savingsData";

export type SavingsPlanConfig = SavingsPlanConfigData["result"];

interface SavingsPlanEntryFormProps {
  isin: string;
  onIsinChange: (v: string) => void;
  isinLocked: boolean;
  configLoading: boolean;
  configError: string | null;
  config: SavingsPlanConfig | null;

  amount: string;
  onAmountChange: (v: string) => void;
  frequency: string;
  onFrequencyChange: (v: string) => void;
  dayOfMonth: number | null;
  onDayOfMonthChange: (v: number) => void;
  yearMonth: string;
  onYearMonthChange: (v: string) => void;
  dynamizationRate: string;
  onDynamizationRateChange: (v: string) => void;
  paymentMethod: string;
  onPaymentMethodChange: (v: string) => void;

  previewArgs: Record<string, unknown>;
  previewError: string | null;
  previewLoading: boolean;
  canPreview: boolean;
  portfolioId?: string;
  onPreview: () => void;
  onClose: () => void;
}

/** `rate` arrives as a decimal fraction string ("0.05"), the same convention
 * `interest_rate` uses elsewhere in this app — render it as a percentage. */
function ratePercent(rate: string): string {
  const n = parseFloat(rate);
  return Number.isFinite(n) ? `${formatNumber(n * 100, n * 100 % 1 === 0 ? 0 : 2)}%` : rate;
}

/**
 * Config-driven savings-plan form: every option offered comes from
 * `get_savings_plan_config` for the chosen ISIN — the form never offers a
 * frequency, payment method, dynamization rate or schedule the config does
 * not list. Fields with no translated label yet are shown with the literal
 * `sc` flag they map to, matching this app's convention elsewhere (see
 * `components/transactions/TransactionFilters.tsx`) for a field not yet in
 * the dictionary.
 */
export default function SavingsPlanEntryForm({
  isin,
  onIsinChange,
  isinLocked,
  configLoading,
  configError,
  config,
  amount,
  onAmountChange,
  frequency,
  onFrequencyChange,
  dayOfMonth,
  onDayOfMonthChange,
  yearMonth,
  onYearMonthChange,
  dynamizationRate,
  onDynamizationRateChange,
  paymentMethod,
  onPaymentMethodChange,
  previewArgs,
  previewError,
  previewLoading,
  canPreview,
  portfolioId,
  onPreview,
  onClose,
}: SavingsPlanEntryFormProps) {
  const { t } = useI18n();

  const schedule = useMemo(
    () => config?.schedules.find((s) => s.day_of_month === dayOfMonth) ?? config?.schedules[0],
    [config, dayOfMonth]
  );

  return (
    <div className="space-y-4">
      <Input
        label={t.watchlist.isinLabel}
        placeholder={t.watchlist.isinPlaceholder}
        value={isin}
        disabled={isinLocked}
        onChange={(e) => onIsinChange(e.target.value.toUpperCase())}
      />

      {configLoading && (
        <div className="flex items-center gap-2 py-2 text-sm text-text-secondary" aria-live="polite">
          <Spinner size={15} />
        </div>
      )}
      {configError && <p className="text-xs text-negative">{configError}</p>}

      {config && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t.savings.amountLabel}
              type="number"
              min={config.amount_limits.min}
              max={config.amount_limits.max}
              step="0.01"
              placeholder={t.savings.amountPlaceholder}
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
            />
            <div className="space-y-1.5">
              <Select
                label={t.savings.frequencyLabel}
                value={frequency}
                onChange={(e) => onFrequencyChange(e.target.value)}
                options={config.frequencies.map((f) => ({
                  value: f,
                  label: enumLabel(t.savings.frequencies, frequencyKey(f)),
                }))}
              />
            </div>
          </div>
          <p className="-mt-2 text-2xs text-text-tertiary">
            {formatCurrency(parseFloat(config.amount_limits.min))} –{" "}
            {formatCurrency(parseFloat(config.amount_limits.max))}
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className="flex items-baseline gap-1.5 text-xs font-medium text-text-secondary">
                {t.savings.dayOfMonthLabel}
                <code className="font-mono text-2xs text-text-tertiary">--day-of-month</code>
              </span>
              <Select
                value={String(dayOfMonth ?? "")}
                onChange={(e) => onDayOfMonthChange(Number(e.target.value))}
                options={config.schedules.map((s) => ({
                  value: String(s.day_of_month),
                  label: String(s.day_of_month),
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <span className="flex items-baseline gap-1.5 text-xs font-medium text-text-secondary">
                {t.savings.yearMonthLabel}
                <code className="font-mono text-2xs text-text-tertiary">--year-month</code>
              </span>
              <Select
                value={yearMonth}
                onChange={(e) => onYearMonthChange(e.target.value)}
                options={(schedule?.available_year_months ?? []).map((ym) => ({
                  value: ym,
                  label: formatDate(`${ym}-01`),
                }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className="flex items-baseline gap-1.5 text-xs font-medium text-text-secondary">
                {t.savings.dynamizationLabel}
                <code className="font-mono text-2xs text-text-tertiary">--dynamization-rate</code>
              </span>
              <Select
                value={dynamizationRate}
                onChange={(e) => onDynamizationRateChange(e.target.value)}
                options={config.dynamization_rates.map((r) => ({ value: r, label: ratePercent(r) }))}
              />
            </div>
            <div className="space-y-1.5">
              <span className="flex items-baseline gap-1.5 text-xs font-medium text-text-secondary">
                {t.savings.paymentMethodLabel}
                <code className="font-mono text-2xs text-text-tertiary">--payment-method</code>
              </span>
              <Select
                value={paymentMethod}
                onChange={(e) => onPaymentMethodChange(e.target.value)}
                options={config.payment_methods.map((m) => ({
                  value: m,
                  label: enumLabel(t.savings.paymentMethods, m),
                }))}
              />
            </div>
          </div>
        </>
      )}

      {previewError && <p className="text-xs text-negative">{previewError}</p>}

      <CliCommand
        commands={renderCliCommand("get_savings_plan_config", { isin: isin.trim(), portfolioId })}
      />

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose} disabled={previewLoading}>
          {t.common.cancel}
        </Button>
        <Button onClick={onPreview} disabled={!canPreview || previewLoading}>
          {previewLoading ? <Spinner size={16} className="mr-2" /> : null}
          {t.savings.createPlan}
        </Button>
      </div>

      <CliCommand commands={renderCliCommand("add_savings_plan", previewArgs)} variant="block" />
    </div>
  );
}
