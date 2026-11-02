import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";
import { api } from "../../api/client";
import { formatDateTime } from "../../lib/format";
import { useI18n } from "../../i18n";
import type { Transaction, TradeSide } from "../../api/types";

// Clock skew between this machine and the backend; widen the search window.
const LOOKBACK_MS = 10 * 60 * 1000;

/**
 * Shown when phase 2 failed with an ambiguous outcome (`ORDER_SUBMISSION_FAILED`
 * without a backend rejection). Follows the CLI's recovery rules: check
 * transactions first, and only resend the exact phase-2 command — same
 * confirmation id, hence same idempotency key — once no order was found.
 */
export default function RecoveryView({
  side,
  isin,
  submittedAt,
  expiresAtEpoch,
  error,
  retrying,
  onRetry,
  onClose,
}: {
  side: TradeSide;
  isin: string;
  submittedAt: number;
  expiresAtEpoch: number;
  error: string;
  retrying: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const r = t.trade.recovery;
  const [checking, setChecking] = useState(false);
  const [matches, setMatches] = useState<Transaction[] | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);

  const expired = Date.now() >= expiresAtEpoch * 1000;

  const check = async () => {
    setChecking(true);
    setCheckFailed(false);
    try {
      const since = submittedAt - LOOKBACK_MS;
      const type = side.toUpperCase();
      const data = await api.getTransactions({
        isin,
        typeFilter: [type],
        fromTime: new Date(since).toISOString(),
        pageSize: 20,
      });
      // Re-apply the filters locally so the list only ever shows candidates
      // for this order, whether or not the backend honoured every filter.
      setMatches(
        data.result.items.filter(
          (tx) =>
            tx.isin?.toUpperCase() === isin.toUpperCase() &&
            tx.type === type &&
            Date.parse(tx.last_event_datetime) >= since
        )
      );
    } catch {
      setMatches(null);
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-text-primary">{r.title}</h3>
            <p className="text-sm text-text-secondary">{r.body}</p>
          </div>
        </div>
        <details className="mt-3 text-xs text-text-secondary">
          <summary className="cursor-pointer">{r.details}</summary>
          <p className="mt-2 whitespace-pre-line break-words font-mono">{error}</p>
        </details>
      </div>

      {checkFailed && <p className="text-sm text-negative">{r.checkFailed}</p>}

      {matches && matches.length === 0 && <p className="text-sm text-text-secondary">{r.none}</p>}

      {matches && matches.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-text-primary">{r.found}</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {matches.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-text-primary">{tx.description}</p>
                  <p className="text-xs text-text-tertiary">{formatDateTime(tx.last_event_datetime)}</p>
                </div>
                <Badge>{tx.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {matches && matches.length === 0 && (
        <p className="text-xs text-text-tertiary">{expired ? r.expired : r.retryHint}</p>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose} disabled={retrying}>
          {t.common.close}
        </Button>
        <Button variant="secondary" onClick={check} disabled={checking || retrying}>
          {checking ? <Spinner size={16} className="mr-2" /> : null}
          {matches || checkFailed ? r.recheck : r.check}
        </Button>
        {matches && matches.length === 0 && !expired && (
          <Button variant={side === "buy" ? "primary" : "danger"} onClick={onRetry} disabled={retrying || checking}>
            {retrying ? <Spinner size={16} className="mr-2" /> : null}
            {r.retry}
          </Button>
        )}
      </div>
    </div>
  );
}
