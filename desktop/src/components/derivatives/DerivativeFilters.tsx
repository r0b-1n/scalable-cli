import { RotateCcw } from "lucide-react";
import { useI18n } from "../../i18n";
import type { DerivativeStrategy, DerivativeType } from "../../api/types";
import Input from "../ui/Input";
import Select from "../ui/Select";
import SegmentedControl from "../ui/SegmentedControl";
import Button from "../ui/Button";
import { CardTitle } from "../ui/Card";
import {
  ALL_ISSUERS,
  ALL_SUBCATEGORIES,
  DERIVATIVES_LIMIT_OPTIONS,
  type DerivativeFilterState,
  issuerLabel,
  sortFieldOptions,
  strategyOptionsFor,
  subcategoryLabel,
} from "./derivativesLib";
import { enumLabel } from "../../i18n";

interface DerivativeFiltersProps {
  type: DerivativeType;
  strategy: DerivativeStrategy;
  filters: DerivativeFilterState;
  limit: number;
  onTypeChange: (next: DerivativeType) => void;
  onStrategyChange: (next: DerivativeStrategy) => void;
  onFiltersChange: (patch: Partial<DerivativeFilterState>) => void;
  onLimitChange: (limit: number) => void;
  onReset: () => void;
}

/** A min/max number-range pair, labelled with ≥/≤ instead of the words "min"/"max". */
function RangeFields({
  label,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  inputType = "number",
}: {
  label: string;
  minValue: string;
  maxValue: string;
  onMinChange: (v: string) => void;
  onMaxChange: (v: string) => void;
  inputType?: "number" | "date";
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        label={`${label} ≥`}
        type={inputType}
        inputMode={inputType === "number" ? "decimal" : undefined}
        value={minValue}
        onChange={(e) => onMinChange(e.target.value)}
      />
      <Input
        label={`${label} ≤`}
        type={inputType}
        inputMode={inputType === "number" ? "decimal" : undefined}
        value={maxValue}
        onChange={(e) => onMaxChange(e.target.value)}
      />
    </div>
  );
}

export default function DerivativeFilters({
  type,
  strategy,
  filters,
  limit,
  onTypeChange,
  onStrategyChange,
  onFiltersChange,
  onLimitChange,
  onReset,
}: DerivativeFiltersProps) {
  const { t } = useI18n();
  const typeOptions: { value: DerivativeType; label: string }[] = [
    { value: "knockout", label: t.search.typeKnockout },
    { value: "warrant", label: t.search.typeWarrant },
    { value: "factor", label: t.search.typeFactor },
  ];

  const toggleIssuer = (code: (typeof ALL_ISSUERS)[number]) => {
    const set = new Set(filters.issuer);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    onFiltersChange({ issuer: Array.from(set) });
  };

  const toggleSubcategory = (code: (typeof ALL_SUBCATEGORIES)[number]) => {
    const set = new Set(filters.productSubcategory);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    onFiltersChange({ productSubcategory: Array.from(set) });
  };

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-bg-card p-5">
      <div className="flex items-center justify-between">
        <CardTitle>{t.derivatives.filters}</CardTitle>
        <button
          onClick={onReset}
          className="flex cursor-pointer items-center gap-1 text-2xs text-text-tertiary transition-colors hover:text-text-primary"
        >
          <RotateCcw size={11} />
          {t.derivatives.resetFilters}
        </button>
      </div>

      {/* Required: product family + strategy */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-text-secondary">{t.derivatives.type}</span>
          <SegmentedControl value={type} onChange={onTypeChange} options={typeOptions} className="w-full" />
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-text-secondary">{t.derivatives.strategy}</span>
          <SegmentedControl
            value={strategy}
            onChange={onStrategyChange}
            options={strategyOptionsFor(type).map((s) => ({ value: s, label: enumLabel(t.search.strategies, s) }))}
            className="w-full"
          />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <span className="mb-2 block text-sm font-medium text-text-secondary">{t.derivatives.issuer}</span>
        <div className="flex flex-wrap gap-1.5">
          {ALL_ISSUERS.map((code) => {
            const active = filters.issuer.includes(code);
            return (
              <button
                key={code}
                onClick={() => toggleIssuer(code)}
                aria-pressed={active}
                className={`cursor-pointer rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors ${
                  active
                    ? "border-accent bg-accent-dim text-accent"
                    : "border-border text-text-secondary hover:text-text-primary"
                }`}
              >
                {issuerLabel(code)}
              </button>
            );
          })}
        </div>
      </div>

      {type === "knockout" && (
        <div className="space-y-1.5 border-t border-border pt-4">
          <span className="block text-sm font-medium text-text-secondary">{t.derivatives.subcategory}</span>
          <div className="flex flex-wrap gap-1.5">
            {ALL_SUBCATEGORIES.map((code) => {
              const active = filters.productSubcategory.includes(code);
              return (
                <button
                  key={code}
                  onClick={() => toggleSubcategory(code)}
                  aria-pressed={active}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors ${
                    active
                      ? "border-accent bg-accent-dim text-accent"
                      : "border-border text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {subcategoryLabel(code)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-border pt-4">
        {type !== "factor" && (
          <RangeFields
            label={t.derivatives.leverage}
            minValue={filters.leverageMin}
            maxValue={filters.leverageMax}
            onMinChange={(v) => onFiltersChange({ leverageMin: v })}
            onMaxChange={(v) => onFiltersChange({ leverageMax: v })}
          />
        )}
        {type !== "factor" && (
          <RangeFields
            label={t.derivatives.strike}
            minValue={filters.strikeMin}
            maxValue={filters.strikeMax}
            onMinChange={(v) => onFiltersChange({ strikeMin: v })}
            onMaxChange={(v) => onFiltersChange({ strikeMax: v })}
          />
        )}
        {type === "knockout" && (
          <RangeFields
            label={t.derivatives.barrier}
            minValue={filters.knockoutBarrierMin}
            maxValue={filters.knockoutBarrierMax}
            onMinChange={(v) => onFiltersChange({ knockoutBarrierMin: v })}
            onMaxChange={(v) => onFiltersChange({ knockoutBarrierMax: v })}
          />
        )}
        {type === "warrant" && (
          <>
            <RangeFields
              label={t.derivatives.omega}
              minValue={filters.omegaMin}
              maxValue={filters.omegaMax}
              onMinChange={(v) => onFiltersChange({ omegaMin: v })}
              onMaxChange={(v) => onFiltersChange({ omegaMax: v })}
            />
            <RangeFields
              label={t.derivatives.delta}
              minValue={filters.deltaMin}
              maxValue={filters.deltaMax}
              onMinChange={(v) => onFiltersChange({ deltaMin: v })}
              onMaxChange={(v) => onFiltersChange({ deltaMax: v })}
            />
          </>
        )}
        {type === "factor" && (
          <RangeFields
            label={t.derivatives.factor}
            minValue={filters.factorMin}
            maxValue={filters.factorMax}
            onMinChange={(v) => onFiltersChange({ factorMin: v })}
            onMaxChange={(v) => onFiltersChange({ factorMax: v })}
          />
        )}
      </div>

      <div className="border-t border-border pt-4">
        <RangeFields
          label={t.derivatives.expiry}
          inputType="date"
          minValue={filters.expiryFrom}
          maxValue={filters.expiryTo}
          onMinChange={(v) => onFiltersChange({ expiryFrom: v })}
          onMaxChange={(v) => onFiltersChange({ expiryTo: v })}
        />
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-end gap-2">
          <Select
            label={t.derivatives.sortBy}
            className="flex-1"
            value={filters.sortField}
            onChange={(e) => onFiltersChange({ sortField: e.target.value as DerivativeFilterState["sortField"] })}
            placeholder="—"
            options={sortFieldOptions(type, t)}
          />
          <SegmentedControl
            value={filters.sortOrder}
            onChange={(v) => onFiltersChange({ sortOrder: v })}
            options={[
              { value: "asc", label: "↑" },
              { value: "desc", label: "↓" },
            ]}
          />
        </div>
        <Select
          value={String(limit)}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          options={DERIVATIVES_LIMIT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
        />
      </div>
    </div>
  );
}
