import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n, enumLabel } from "../../i18n";
import { useToast } from "../ui/Toast";
import { renderCliCommand } from "../../lib/cliLog";
import CliCommand from "../ui/CliCommand";
import Spinner from "../ui/Spinner";
import EmptyState from "../ui/EmptyState";
import type { SecuritySummary } from "../../api/types";
import { formatCurrency } from "../../lib/format";
import { Search, X, ArrowRight, SearchX, Plus, Star } from "lucide-react";

interface SearchModalProps {
  onClose: () => void;
}

/**
 * Global Ctrl/Cmd+K search: debounced `sc broker search`, arrow-key
 * navigation, and a quick action per row (buy, watch, open) so a security
 * can be acted on without leaving the palette.
 */
export default function SearchModal({ onClose }: SearchModalProps) {
  const navigate = useNavigate();
  const activePortfolioId = useAppStore((s) => s.activePortfolioId);
  const openTradeModal = useAppStore((s) => s.openTradeModal);
  const { t } = useI18n();
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SecuritySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced security search — the modal's one job.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
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
  }, [query, activePortfolioId]);

  useEffect(() => {
    setFocusedIndex(results.length > 0 ? 0 : -1);
  }, [results]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${focusedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  const handleOpenDetail = (isin: string) => {
    navigate(`/security/${isin}`);
    onClose();
  };

  const handleBuy = (isin: string) => {
    openTradeModal("buy", isin);
    onClose();
  };

  const handleWatch = async (item: SecuritySummary) => {
    try {
      await api.addToWatchlist(item.isin, activePortfolioId || undefined);
      push({ tone: "success", title: t.common.add, description: item.name || item.isin });
    } catch (err) {
      push({
        tone: "error",
        title: t.common.loadFailed,
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  // Esc-to-close plus roving arrow-key focus over the result list; Enter
  // opens the focused row's detail page, same as clicking it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i < 0 ? 0 : i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        handleOpenDetail(results[focusedIndex].isin);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, results, focusedIndex]);

  const cliCommand = renderCliCommand("search_securities", {
    query: query.trim() || undefined,
    portfolioId: activePortfolioId || undefined,
  });

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
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search.placeholderSecurities}
            className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none"
          />
          {loading && <Spinner size={16} />}
          <button
            onClick={onClose}
            aria-label={t.common.cancel}
            className="p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <div ref={listRef} className="max-h-[360px] overflow-y-auto">
          {query.trim() && !loading && results.length === 0 ? (
            <EmptyState icon={<SearchX size={18} />} title={t.search.noResults} className="py-10" />
          ) : results.length > 0 ? (
            <div className="divide-y divide-border py-1.5">
              {results.map((r, i) => {
                const focused = i === focusedIndex;
                return (
                  <div
                    key={r.isin}
                    data-index={i}
                    onMouseEnter={() => setFocusedIndex(i)}
                    onClick={() => handleOpenDetail(r.isin)}
                    className={`group flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors ${
                      focused ? "bg-bg-card-hover/60" : "hover:bg-bg-card-hover/60"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="w-8 h-8 shrink-0 rounded-full bg-bg-card flex items-center justify-center text-xs font-semibold text-text-tertiary">
                        {(r.name || r.isin).charAt(0)}
                      </div>
                      <div className="min-w-0 text-left">
                        <p className="truncate text-sm font-medium text-text-primary">{r.name || r.isin}</p>
                        <p className="flex items-center gap-1.5 text-2xs text-text-tertiary">
                          <span>{r.isin}</span>
                          <span>·</span>
                          <span>{enumLabel(t.common.securityTypes, r.security_type)}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="mr-1 text-sm tabular-nums text-text-secondary">
                        {r.quote_mid_price != null ? formatCurrency(r.quote_mid_price, r.quote_currency || "EUR") : "—"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBuy(r.isin);
                        }}
                        aria-label={t.security.buy}
                        title={t.security.buy}
                        className="cursor-pointer rounded-full p-1.5 text-text-tertiary opacity-0 transition-all hover:bg-positive/15 hover:text-positive group-hover:opacity-100"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleWatch(r);
                        }}
                        aria-label={t.watchlist.addSecurity}
                        title={t.watchlist.addSecurity}
                        className="cursor-pointer rounded-full p-1.5 text-text-tertiary opacity-0 transition-all hover:bg-accent-dim hover:text-accent group-hover:opacity-100"
                      >
                        <Star size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetail(r.isin);
                        }}
                        aria-label={t.dashboard.viewAll}
                        className="cursor-pointer rounded-full p-1.5 text-text-tertiary transition-colors hover:bg-hover hover:text-text-primary"
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border">
          <CliCommand commands={cliCommand} className="min-w-0" />
          <p className="shrink-0 text-2xs text-text-tertiary">
            {t.search.escBefore}
            <kbd className="px-1.5 py-0.5 bg-bg-inset rounded-md border border-border">Esc</kbd>
            {t.search.escAfter}
          </p>
        </div>
      </div>
    </div>
  );
}
