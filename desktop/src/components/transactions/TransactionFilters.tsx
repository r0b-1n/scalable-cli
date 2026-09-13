import Card, { CardTitle } from "../ui/Card";
import Input from "../ui/Input";
import SegmentedControl from "../ui/SegmentedControl";
import Button from "../ui/Button";
import { enumLabel, useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { Search } from "lucide-react";
import { TRANSACTION_STATUSES, TRANSACTION_TYPES } from "../../api/types";

const PAGE_SIZE_OPTIONS = ["10", "25", "50", "100"];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors",
        active
          ? "border-accent bg-accent-dim text-accent"
          : "border-border-strong text-text-secondary hover:text-text-primary hover:bg-hover"
      )}
    >
      {children}
    </button>
  );
}

export interface TransactionFiltersState {
  types: string[];
  statuses: string[];
  search: string;
  isin: string;
  from: string;
  to: string;
  includeReinvestmentSubtypes: boolean;
  pageSize: number;
}

interface TransactionFiltersProps {
  draft: TransactionFiltersState;
  onChange: (next: TransactionFiltersState) => void;
  onApply: () => void;
  onReset: () => void;
}

/**
 * The full `sc broker transactions` filter surface. Type/status are
 * repeatable flags (`--type-filter`, `--status`), so they toggle as chips
 * rather than a single-value dropdown; from/to, the reinvestment-subtypes
 * toggle and page size are labelled with their literal CLI flag since no
 * translated copy exists for them yet (reported separately).
 */
export default function TransactionFilters({ draft, onChange, onApply, onReset }: TransactionFiltersProps) {
  const { t } = useI18n();

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <CardTitle>{t.derivatives.filters}</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t.common.reset}
          </Button>
          <Button size="sm" onClick={onApply}>
            {t.common.apply}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            className="pl-9"
            placeholder={t.transactions.searchPlaceholder}
            value={draft.search}
            onChange={(e) => onChange({ ...draft, search: e.target.value })}
          />
        </div>
        <Input
          label={t.watchlist.isinLabel}
          placeholder={t.watchlist.isinPlaceholder}
          value={draft.isin}
          onChange={(e) => onChange({ ...draft, isin: e.target.value.toUpperCase() })}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-secondary">{t.transactions.colType}</p>
        <div className="flex flex-wrap gap-1.5">
          {TRANSACTION_TYPES.map((v) => (
            <Chip
              key={v}
              active={draft.types.includes(v)}
              onClick={() => onChange({ ...draft, types: toggle(draft.types, v) })}
            >
              {enumLabel(t.transactions.txTypes, v)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-secondary">{t.transactions.colStatus}</p>
        <div className="flex flex-wrap gap-1.5">
          {TRANSACTION_STATUSES.map((v) => (
            <Chip
              key={v}
              active={draft.statuses.includes(v)}
              onClick={() => onChange({ ...draft, statuses: toggle(draft.statuses, v) })}
            >
              {enumLabel(t.transactions.statuses, v)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <span className="block font-mono text-2xs text-text-tertiary">--from-time</span>
          <Input
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => onChange({ ...draft, from: e.target.value })}
            className="w-40"
          />
        </div>
        <div className="space-y-1.5">
          <span className="block font-mono text-2xs text-text-tertiary">--to-time</span>
          <Input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => onChange({ ...draft, to: e.target.value })}
            className="w-40"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 pb-2.5">
          <input
            type="checkbox"
            checked={draft.includeReinvestmentSubtypes}
            onChange={(e) => onChange({ ...draft, includeReinvestmentSubtypes: e.target.checked })}
            className="cursor-pointer"
          />
          <span className="font-mono text-2xs text-text-tertiary">--include-reinvestment-subtypes</span>
        </label>

        <div className="ml-auto space-y-1.5">
          <span className="block font-mono text-2xs text-text-tertiary">--page-size</span>
          <SegmentedControl
            options={PAGE_SIZE_OPTIONS.map((v) => ({ value: v, label: v }))}
            value={String(draft.pageSize)}
            onChange={(v) => onChange({ ...draft, pageSize: Number(v) })}
          />
        </div>
      </div>
    </Card>
  );
}
