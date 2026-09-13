import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Spinner from "../ui/Spinner";
import CliCommand from "../ui/CliCommand";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency } from "../../lib/format";
import { useI18n } from "../../i18n";
import { useToast } from "../ui/Toast";
import { api } from "../../api/client";
import type { WatchlistRow } from "./watchlistColumns";

interface AlertQuickModalProps {
  row: WatchlistRow | null;
  portfolioId?: string;
  onClose: () => void;
}

/**
 * Composite: watchlist row → price alert, one click. Reads a fresh quote
 * (never the possibly-stale watchlist price) and creates an alert at
 * `price * (1 ± pct/100)` with a single button press, in either direction.
 */
export default function AlertQuickModal({ row, portfolioId, onClose }: AlertQuickModalProps) {
  const { t } = useI18n();
  const { push } = useToast();
  const [pct, setPct] = useState("5");
  const [price, setPrice] = useState<number | null>(null);
  const [currency, setCurrency] = useState("EUR");
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isin = row?.isin ?? null;

  useEffect(() => {
    if (!isin) return;
    setPct("5");
    setError(null);
    setPrice(null);
    setLoadingPrice(true);
    let cancelled = false;
    api
      .getQuote(isin, { portfolioId })
      .then((data) => {
        if (cancelled) return;
        setPrice(data.result.quote_mid_price);
        setCurrency(data.result.quote_currency || "EUR");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t.common.loadFailed);
      })
      .finally(() => {
        if (!cancelled) setLoadingPrice(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isin, portfolioId]);

  if (!row) return null;

  const pctNum = parseFloat(pct);
  const validPct = Number.isFinite(pctNum) && pctNum > 0;
  const target = (dir: 1 | -1): number | null =>
    price != null && validPct ? price * (1 + (dir * pctNum) / 100) : null;

  const submit = async (dir: 1 | -1) => {
    const t2 = target(dir);
    if (t2 == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.addPriceAlert({ isin: row.isin, price: t2.toFixed(2), portfolioId });
      push({
        tone: "success",
        title: t.alerts.createAlert,
        description: `${row.name || row.isin} · ${formatCurrency(t2, currency)}`,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  const above = target(1);
  const below = target(-1);

  return (
    <Modal isOpen onClose={onClose} title={t.watchlist.alertFromPrice} maxWidth="max-w-sm">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-text-primary">{row.name || row.isin}</p>
          <p className="text-2xs text-text-tertiary">{row.isin}</p>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border bg-bg-inset p-3">
          <span className="text-xs text-text-secondary">{t.security.chartPrice}</span>
          {loadingPrice ? (
            <Spinner size={14} />
          ) : (
            <span className="text-sm font-medium tabular-nums text-text-primary">
              {price != null ? formatCurrency(price, currency) : "—"}
            </span>
          )}
        </div>

        <Input
          label={t.rebalancing.tolerance}
          type="number"
          min="0"
          step="0.1"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
        />

        {error && (
          <div className="rounded-lg border border-negative/20 bg-negative/10 p-3">
            <p className="text-xs text-negative">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="success" disabled={above == null || busy} onClick={() => submit(1)}>
            <ArrowUpRight size={14} className="mr-1.5" />
            {above != null ? formatCurrency(above, currency) : "—"}
          </Button>
          <Button variant="danger" disabled={below == null || busy} onClick={() => submit(-1)}>
            <ArrowDownRight size={14} className="mr-1.5" />
            {below != null ? formatCurrency(below, currency) : "—"}
          </Button>
        </div>

        <CliCommand
          commands={renderCliCommand("add_price_alert", {
            isin: row.isin,
            price: above != null ? above.toFixed(2) : "<price>",
            portfolioId,
          })}
        />
      </div>
    </Modal>
  );
}
