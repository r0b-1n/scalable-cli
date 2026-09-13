import { useEffect, useState } from "react";
import { Search, SearchX, X } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import type { SecuritySummary } from "../../api/types";
import { formatCurrency } from "../../lib/format";
import Input from "../ui/Input";
import Spinner from "../ui/Spinner";
import EmptyState from "../ui/EmptyState";
import { ISIN_PATTERN } from "./derivativesLib";

export interface UnderlyingSelection {
  isin: string;
  name: string | null;
}

interface UnderlyingPickerProps {
  value: UnderlyingSelection | null;
  onSelect: (selection: UnderlyingSelection) => void;
  onClear: () => void;
}

/**
 * The underlying picker required by the derivatives screen: search by name
 * (`api.search`), or paste an ISIN straight in. Once an underlying is chosen
 * it collapses to a chip so the filter panel below has room to breathe.
 */
export default function UnderlyingPicker({ value, onSelect, onClear }: UnderlyingPickerProps) {
  const activePortfolioId = useAppStore((s) => s.activePortfolioId);
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SecuritySummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (value) return;
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const trimmed = query.trim();
    if (ISIN_PATTERN.test(trimmed)) {
      onSelect({ isin: trimmed.toUpperCase(), name: null });
      setQuery("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.search(query, { portfolioId: activePortfolioId || undefined });
        if (!cancelled) setResults(data.result?.items ?? []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, value, activePortfolioId]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-border bg-bg-card py-1.5 pr-1.5 pl-3.5">
        <span className="text-sm font-medium text-text-primary">{value.name || value.isin}</span>
        {value.name && <span className="text-2xs text-text-tertiary">{value.isin}</span>}
        <button
          onClick={onClear}
          aria-label={t.search.clearUnderlying}
          title={t.search.clearUnderlying}
          className="cursor-pointer rounded-full p-1.5 text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-tertiary" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.search.placeholderUnderlying}
          className="pl-9"
        />
        {loading && <Spinner size={15} className="absolute top-1/2 right-3 -translate-y-1/2" />}
      </div>
      {query.trim() && !loading && results.length === 0 ? (
        <EmptyState icon={<SearchX size={16} />} title={t.search.noResults} className="py-6" />
      ) : results.length > 0 ? (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-card">
          {results.map((r) => (
            <button
              key={r.isin}
              onClick={() => {
                onSelect({ isin: r.isin, name: r.name });
                setQuery("");
                setResults([]);
              }}
              className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-primary">{r.name || r.isin}</p>
                <p className="text-2xs text-text-tertiary">{r.isin}</p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                {r.quote_mid_price != null ? formatCurrency(r.quote_mid_price, r.quote_currency || "EUR") : "—"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
