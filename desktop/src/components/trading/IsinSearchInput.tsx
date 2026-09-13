import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { SecuritySummary } from "../../api/types";
import Input from "../ui/Input";
import Spinner from "../ui/Spinner";
import { enumLabel, useI18n } from "../../i18n";

interface IsinSearchInputProps {
  value: string;
  onChange: (isin: string) => void;
  onSelect?: (item: SecuritySummary) => void;
  portfolioId?: string;
  disabled?: boolean;
}

const ISIN_PATTERN = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/;

/**
 * The trade ticket's ISIN field: a plain text input that also searches
 * `sc broker search` as the user types a name, so the ticket is prefillable
 * (from a security page) and searchable (opened blank from a quick action).
 */
export default function IsinSearchInput({
  value,
  onChange,
  onSelect,
  portfolioId,
  disabled,
}: IsinSearchInputProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<SecuritySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // A prefill or an external reset (e.g. the modal closing) should replace
  // whatever the user was typing.
  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    const q = query.trim();
    if (!q || ISIN_PATTERN.test(q)) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.search(q, { portfolioId });
        setResults(data.result?.items ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, portfolioId]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handlePick = (item: SecuritySummary) => {
    setQuery(item.isin);
    setOpen(false);
    setResults([]);
    onChange(item.isin);
    onSelect?.(item);
  };

  return (
    <div className="relative" ref={containerRef}>
      <Input
        label={t.trade.isinLabel}
        placeholder={t.trade.isinPlaceholder}
        value={query}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          setOpen(true);
          onChange(v);
        }}
      />
      {open && (loading || results.length > 0) && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-modal">
          {loading ? (
            <div className="flex items-center justify-center py-3">
              <Spinner size={16} />
            </div>
          ) : (
            <div className="max-h-64 divide-y divide-border overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.isin}
                  type="button"
                  onClick={() => handlePick(r)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-card-hover/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text-primary">{r.name}</span>
                    <span className="block text-2xs text-text-tertiary">{r.isin}</span>
                  </span>
                  <span className="shrink-0 text-2xs text-text-tertiary">
                    {enumLabel(t.common.securityTypes, r.security_type)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
