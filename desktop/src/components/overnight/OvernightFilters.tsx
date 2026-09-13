import { Search } from "lucide-react";
import Card, { CardTitle } from "../ui/Card";
import Input from "../ui/Input";
import SegmentedControl from "../ui/SegmentedControl";
import Button from "../ui/Button";
import { cn } from "../../lib/utils";
import { enumLabel, useI18n } from "../../i18n";

const TYPE_FILTER_VALUES = ["DEPOSIT", "WITHDRAWAL", "INTEREST", "CASH_TRANSFER_IN", "CASH_TRANSFER_OUT"];
const PAGE_SIZE_OPTIONS = ["10", "25", "50", "100"];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

export interface OvernightFiltersState {
  types: string[];
  search: string;
  from: string;
  to: string;
  pageSize: number;
}

interface OvernightFiltersProps {
  draft: OvernightFiltersState;
  onChange: (next: OvernightFiltersState) => void;
  onApply: () => void;
  onReset: () => void;
}

/**
 * The full `sc overnight transactions` filter surface — the app previously
 * only exposed the type filter. From/to and page size are labelled with
 * their literal CLI flag since no translated copy exists for them yet
 * (reported separately), matching the convention already used by
 * `components/transactions/TransactionFilters.tsx`.
 */
export default function OvernightFilters({ draft, onChange, onApply, onReset }: OvernightFiltersProps) {
  const { t } = useI18n();

  const toggleType = (value: string) =>
    onChange({
      ...draft,
      types: draft.types.includes(value) ? draft.types.filter((v) => v !== value) : [...draft.types, value],
    });

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <CardTitle>{t.transactions.colType}</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t.common.reset}
          </Button>
          <Button size="sm" onClick={onApply}>
            {t.common.apply}
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <Input
          className="pl-9"
          placeholder={t.transactions.searchPlaceholder}
          value={draft.search}
          onChange={(e) => onChange({ ...draft, search: e.target.value })}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TYPE_FILTER_VALUES.map((v) => (
          <Chip key={v} active={draft.types.includes(v)} onClick={() => toggleType(v)}>
            {enumLabel(t.overnight.cashTxTypes, v)}
          </Chip>
        ))}
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
