import { useEffect, useState } from "react";
import { SearchX } from "lucide-react";
import Modal from "../ui/Modal";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";
import EmptyState from "../ui/EmptyState";
import CliCommand from "../ui/CliCommand";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency } from "../../lib/format";
import { useI18n } from "../../i18n";
import { useToast } from "../ui/Toast";
import { api } from "../../api/client";
import type { SecuritySummary } from "../../api/types";
import { ISIN_PATTERN } from "./watchlistLib";

interface AddSecurityModalProps {
  open: boolean;
  onClose: () => void;
  portfolioId?: string;
  onAdded: () => void;
}

/**
 * Add-to-watchlist entry point: paste a valid ISIN directly, or search by
 * name and add straight from the result row — both call the same
 * `add_to_watchlist` command underneath.
 */
export default function AddSecurityModal({ open, onClose, portfolioId, onAdded }: AddSecurityModalProps) {
  const { t } = useI18n();
  const { push } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SecuritySummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setError(null);
      setAdding(null);
    }
  }, [open]);

  const trimmed = query.trim();
  const isIsin = ISIN_PATTERN.test(trimmed);

  useEffect(() => {
    if (!open || !trimmed || isIsin) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.search(trimmed, { portfolioId });
        if (!cancelled) setResults(data.result?.items ?? []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, isIsin, open, portfolioId]);

  const add = async (isin: string) => {
    if (adding) return;
    setAdding(isin);
    setError(null);
    try {
      await api.addToWatchlist(isin, portfolioId);
      push({ tone: "success", title: t.watchlist.added, description: isin });
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.actionFailed);
    } finally {
      setAdding(null);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={t.watchlist.modalTitle}>
      <div className="space-y-4">
        <Input
          label={t.watchlist.isinLabel}
          placeholder={t.watchlist.isinPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isIsin) add(trimmed.toUpperCase());
          }}
        />

        {error && (
          <div className="rounded-lg border border-negative/20 bg-negative/10 p-3">
            <p className="text-xs text-negative">{error}</p>
          </div>
        )}

        {isIsin ? (
          <Button className="w-full" onClick={() => add(trimmed.toUpperCase())} disabled={adding !== null}>
            {adding ? <Spinner size={16} className="mr-2" /> : null}
            {t.common.add} · {trimmed.toUpperCase()}
          </Button>
        ) : trimmed ? (
          searching ? (
            <div className="flex justify-center py-6">
              <Spinner size={20} />
            </div>
          ) : results.length === 0 ? (
            <EmptyState icon={<SearchX size={16} />} title={t.search.noResults} className="py-6" />
          ) : (
            <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {results.map((r) => (
                <button
                  key={r.isin}
                  onClick={() => add(r.isin)}
                  disabled={adding !== null}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">{r.name || r.isin}</p>
                    <p className="text-2xs text-text-tertiary">{r.isin}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                    {adding === r.isin ? (
                      <Spinner size={14} />
                    ) : r.quote_mid_price != null ? (
                      formatCurrency(r.quote_mid_price, r.quote_currency || "EUR")
                    ) : (
                      "—"
                    )}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : null}

        <CliCommand
          commands={renderCliCommand("add_to_watchlist", { isin: isIsin ? trimmed.toUpperCase() : "<isin>", portfolioId })}
        />

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
