import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { Derivative, SearchResult } from "../../api/types";
import { formatNumber } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import Spinner from "../ui/Spinner";
import Select from "../ui/Select";
import SegmentedControl from "../ui/SegmentedControl";
import EmptyState from "../ui/EmptyState";
import { Search, X, ArrowRight, SearchX } from "lucide-react";

interface SearchModalProps {
  onClose: () => void;
}

type SearchTab = "securities" | "derivatives";
type DerivativeType = "knockout" | "warrant" | "factor";
type DerivativeStrategy = "long" | "short" | "call" | "put";

const ISIN_PATTERN = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/;

function strategyOptionsFor(type: DerivativeType): DerivativeStrategy[] {
  return type === "warrant" ? ["call", "put"] : ["long", "short"];
}

function formatDerivativePrice(price: Derivative["strike"]): string {
  if (!price || price.value == null) return "—";
  const value = formatNumber(price.value);
  return price.kind === "money" && price.currency_iso_code
    ? `${value} ${price.currency_iso_code}`
    : value;
}

export default function SearchModal({ onClose }: SearchModalProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<SearchTab>("securities");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const [underlying, setUnderlying] = useState<{ isin: string; name: string | null } | null>(null);
  const [derivativeType, setDerivativeType] = useState<DerivativeType>("knockout");
  const [strategy, setStrategy] = useState<DerivativeStrategy>("long");
  const [derivatives, setDerivatives] = useState<Derivative[]>([]);
  const [derivativesTotal, setDerivativesTotal] = useState<number | null>(null);
  const [derivativesError, setDerivativesError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [tab]);

  // The footer promises Esc-to-close; actually deliver it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleTabChange = (next: SearchTab) => {
    if (next === tab) return;
    setTab(next);
    // A query typed on one tab means nothing on the other.
    setQuery("");
    setResults([]);
  };

  // Securities search — feeds the securities tab directly and doubles as the
  // underlying picker on the derivatives tab while no underlying is selected.
  useEffect(() => {
    if (tab === "derivatives" && underlying) return;
    if (!query.trim()) {
      setResults([]);
      return;
    }
    // A pasted ISIN on the derivatives tab is used as underlying directly.
    if (tab === "derivatives" && ISIN_PATTERN.test(query.trim())) {
      setUnderlying({ isin: query.trim().toUpperCase(), name: null });
      setQuery("");
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.search(query);
        setResults(data.result?.items ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, tab, underlying]);

  // Derivatives search — runs once an underlying is selected.
  useEffect(() => {
    if (tab !== "derivatives" || !underlying) {
      setDerivatives([]);
      setDerivativesTotal(null);
      setDerivativesError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setDerivativesError(null);
      try {
        const data = await api.getDerivatives({
          underlying: underlying.isin,
          derivativeType,
          strategy,
          limit: 50,
        });
        if (!cancelled) {
          setDerivatives(data.result?.items ?? []);
          setDerivativesTotal(data.result?.total_available ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          setDerivatives([]);
          setDerivativesTotal(null);
          setDerivativesError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, underlying, derivativeType, strategy]);

  const handleTypeChange = (next: DerivativeType) => {
    setDerivativeType(next);
    const options = strategyOptionsFor(next);
    if (!options.includes(strategy)) {
      // Keep the direction when switching families: long≙call, short≙put.
      setStrategy(strategy === "long" || strategy === "call" ? options[0] : options[1]);
    }
  };

  const handleSelect = (isin: string) => {
    navigate(`/security/${isin}`);
    onClose();
  };

  const formatExpiry = (d: Derivative): string =>
    d.expiry_is_open_end ? t.search.openEnd : (d.expiry_date?.date ?? "—");

  const handlePickUnderlying = (r: SearchResult) => {
    setUnderlying({ isin: r.isin, name: r.name });
    setQuery("");
    setResults([]);
  };

  const showUnderlyingPicker = tab === "derivatives" && !underlying;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl mx-4 bg-bg-secondary border border-border rounded-2xl shadow-modal overflow-hidden animate-scale-in">
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          <Search size={17} className="text-text-tertiary shrink-0" />
          {tab === "derivatives" && underlying && (
            <span className="flex items-center gap-1.5 shrink-0 pl-2.5 pr-1 py-1 rounded-full bg-bg-card border border-border text-xs text-text-primary">
              {underlying.name || underlying.isin}
              <button
                onClick={() => setUnderlying(null)}
                className="p-0.5 rounded-full text-text-secondary hover:text-text-primary cursor-pointer"
                aria-label={t.search.clearUnderlying}
              >
                <X size={12} />
              </button>
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === "securities"
                ? t.search.placeholderSecurities
                : underlying
                  ? t.search.placeholderUnderlyingSelected
                  : t.search.placeholderUnderlying
            }
            className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none"
          />
          {loading && <Spinner size={16} />}
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
          <SegmentedControl<SearchTab>
            options={[
              { value: "securities", label: t.search.tabSecurities },
              { value: "derivatives", label: t.search.tabDerivatives },
            ]}
            value={tab}
            onChange={handleTabChange}
          />
          {tab === "derivatives" && (
            <div className="flex items-center gap-2">
              <Select
                className="h-8 w-30 text-xs"
                options={[
                  { value: "knockout", label: t.search.typeKnockout },
                  { value: "warrant", label: t.search.typeWarrant },
                  { value: "factor", label: t.search.typeFactor },
                ]}
                value={derivativeType}
                onChange={(e) => handleTypeChange(e.target.value as DerivativeType)}
              />
              <Select
                className="h-8 w-24 text-xs"
                options={strategyOptionsFor(derivativeType).map((s) => ({
                  value: s,
                  label: enumLabel(t.search.strategies, s),
                }))}
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as DerivativeStrategy)}
              />
            </div>
          )}
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {tab === "securities" || showUnderlyingPicker ? (
            results.length === 0 && query.trim() && !loading ? (
              <EmptyState
                icon={<SearchX size={18} />}
                title={t.search.noResults}
                className="py-10"
              />
            ) : (
              <div className="py-1.5">
                {showUnderlyingPicker && !query.trim() && (
                  <p className="px-4 py-2.5 text-xs text-text-tertiary">{t.search.pickUnderlying}</p>
                )}
                <div className="divide-y divide-border">
                  {results.map((r) => (
                    <button
                      key={r.isin}
                      onClick={() =>
                        showUnderlyingPicker ? handlePickUnderlying(r) : handleSelect(r.isin)
                      }
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-card-hover/60 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-bg-card flex items-center justify-center text-xs font-semibold text-text-tertiary">
                          {(r.name || r.isin).charAt(0)}
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-text-primary">{r.name}</p>
                          <p className="text-2xs text-text-tertiary">{r.isin}</p>
                        </div>
                      </div>
                      <ArrowRight size={14} className="text-text-tertiary" />
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : derivativesError ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{derivativesError}</p>
            </div>
          ) : derivatives.length === 0 && !loading ? (
            <EmptyState
              icon={<SearchX size={18} />}
              title={t.search.noDerivativesTitle}
              description={t.search.noDerivativesDesc}
              className="py-10"
            />
          ) : (
            <div className="py-1.5">
              {derivativesTotal != null && (
                <p className="px-4 py-1.5 text-2xs text-text-tertiary tabular-nums">
                  {t.search.resultsCount(derivatives.length, derivativesTotal)}
                </p>
              )}
              <div className="divide-y divide-border">
                {derivatives.map((d) => (
                  <button
                    key={d.isin}
                    onClick={() => handleSelect(d.isin)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-bg-card-hover/60 transition-colors cursor-pointer"
                  >
                    <div className="text-left min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {d.isin}
                        {d.product_subcategory && (
                          <span className="ml-2 text-2xs font-normal text-text-tertiary uppercase">
                            {d.product_subcategory.replace(/_/g, " ")}
                          </span>
                        )}
                      </p>
                      <p className="text-2xs text-text-tertiary truncate">
                        {[d.issuer, formatExpiry(d)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="text-right shrink-0 text-xs text-text-secondary tabular-nums">
                      {derivativeType === "factor" ? (
                        <p>{t.search.factorPrefix} {d.factor != null ? formatNumber(d.factor, 0) : "—"}</p>
                      ) : (
                        <p>{t.search.leveragePrefix} {d.leverage != null ? formatNumber(d.leverage) : "—"}</p>
                      )}
                      <p>
                        {derivativeType === "knockout"
                          ? `KO ${formatDerivativePrice(d.knockout_barrier)}`
                          : `Strike ${formatDerivativePrice(d.strike)}`}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-border">
          <p className="text-2xs text-text-tertiary">
            {t.search.escBefore}
            <kbd className="px-1.5 py-0.5 bg-bg-inset rounded-md border border-border">Esc</kbd>
            {t.search.escAfter}
          </p>
        </div>
      </div>
    </div>
  );
}
