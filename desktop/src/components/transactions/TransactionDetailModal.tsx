import { useEffect, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import Modal from "../ui/Modal";
import Spinner from "../ui/Spinner";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import Card from "../ui/Card";
import CliCommand from "../ui/CliCommand";
import { api } from "../../api/client";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency, formatDateTime, formatNumber } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import { prettifyKey } from "../../lib/disclosure";
import type { Transaction } from "../../api/types";

interface TransactionDetailModalProps {
  /** The row to show detail for, or null to keep the modal closed. */
  transaction: Transaction | null;
  portfolioId?: string;
  onClose: () => void;
}

// `get_transaction_detail` returns a large, open-ended object with no fixed
// schema across transaction types (fees, a German tax breakdown, execution
// history, venue, order kind, linked transactions, …), so values are
// formatted defensively by best-effort key matching rather than a hand-picked
// field list the CLI might not actually return for a given row.
const MONEY_KEY = /amount|price|total|value|fee|tax|cost|volume|premium|balance|charge/i;
const NON_MONEY_KEY = /(?:^|[_-])(?:id|rate|percentage|percent|count|number)(?:$|[_-])|currency$|isin|iso|status|kind|type$/i;
const DATE_KEY = /date|time|timestamp/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function looksNumericString(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v.trim());
}

function looksIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
}

/** Formats one raw JSON leaf value, applying money/date formatting where the
 * key name suggests it and otherwise showing the value as-is. */
function renderLeaf(key: string, value: unknown, currency: string): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-text-tertiary">—</span>;
  }
  if (typeof value === "boolean") {
    return value ? (
      <Check size={14} className="inline text-positive" aria-hidden="true" />
    ) : (
      <X size={14} className="inline text-text-tertiary" aria-hidden="true" />
    );
  }
  const isMoney = MONEY_KEY.test(key) && !NON_MONEY_KEY.test(key);
  if (typeof value === "number") {
    if (isMoney) return <span className="tabular-nums">{formatCurrency(value, currency)}</span>;
    return <span className="tabular-nums">{formatNumber(value, Number.isInteger(value) ? 0 : 2)}</span>;
  }
  if (typeof value === "string") {
    if (DATE_KEY.test(key) && looksIsoDate(value)) {
      return <span className="tabular-nums">{formatDateTime(value)}</span>;
    }
    if (isMoney && looksNumericString(value)) {
      return <span className="tabular-nums">{formatCurrency(parseFloat(value), currency)}</span>;
    }
    return <span className="break-words">{value}</span>;
  }
  return <span className="break-all">{String(value)}</span>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-right text-sm font-medium text-text-primary">{children}</span>
    </div>
  );
}

/** Recursively renders any JSON value as labelled rows, depth-bounded so a
 * deeply nested payload can never hang the UI, and never throwing on a
 * missing or oddly-typed key. */
function DetailEntries({
  entries,
  currency,
  depth,
}: {
  entries: [string, unknown][];
  currency: string;
  depth: number;
}) {
  if (depth > 4) return null;
  return (
    <div className="divide-y divide-border/60">
      {entries.map(([key, value]) => {
        if (Array.isArray(value)) {
          if (value.length === 0) {
            return (
              <div key={key} className="py-1.5">
                <Row label={prettifyKey(key)}>—</Row>
              </div>
            );
          }
          const allPrimitive = value.every((v) => !isPlainObject(v) && !Array.isArray(v));
          return (
            <div key={key} className="space-y-1.5 py-2.5">
              <p className="text-xs font-medium text-text-secondary">{prettifyKey(key)}</p>
              {allPrimitive ? (
                <p className="text-sm text-text-primary">{value.map((v) => String(v)).join(", ")}</p>
              ) : (
                <div className="space-y-2">
                  {value.map((item, i) => (
                    <div key={i} className="rounded-lg border border-border/60 bg-bg-inset p-2.5">
                      {isPlainObject(item) ? (
                        <DetailEntries entries={Object.entries(item)} currency={currency} depth={depth + 1} />
                      ) : (
                        <span className="text-sm text-text-primary">{String(item)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }
        if (isPlainObject(value)) {
          const nested = Object.entries(value);
          if (nested.length === 0) {
            return (
              <div key={key} className="py-1.5">
                <Row label={prettifyKey(key)}>—</Row>
              </div>
            );
          }
          return (
            <div key={key} className="space-y-1 py-2.5">
              <p className="text-xs font-medium text-text-secondary">{prettifyKey(key)}</p>
              <div className="rounded-lg border border-border/60 bg-bg-inset p-2.5">
                <DetailEntries entries={nested} currency={currency} depth={depth + 1} />
              </div>
            </div>
          );
        }
        return (
          <div key={key} className="py-1.5">
            <Row label={prettifyKey(key)}>{renderLeaf(key, value, currency)}</Row>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Full detail for one transaction/order row, shared by the Transactions and
 * Orders screens — both list the same `Transaction` rows through the same
 * `get_transaction_detail` command, so they show the same detail rather than
 * two views that can disagree.
 *
 * Every top-level key of the payload becomes its own labelled section (fees,
 * taxes, execution history, venue, order kind, linked transactions, …)
 * instead of a fixed field list, since the shape differs across transaction
 * types and the CLI can add keys at any time.
 */
export default function TransactionDetailModal({
  transaction,
  portfolioId,
  onClose,
}: TransactionDetailModalProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const txId = transaction?.id ?? null;

  useEffect(() => {
    if (!txId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getTransactionDetail(txId, portfolioId)
      .then((res) => {
        if (cancelled) return;
        setDetail((res?.result as Record<string, unknown>) ?? {});
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t.common.loadFailed);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [txId, portfolioId, reloadKey, t.common.loadFailed]);

  const detailCurrency = typeof detail?.currency === "string" ? detail.currency : undefined;
  const currency = detailCurrency || transaction?.currency || "EUR";
  const entries = detail ? Object.entries(detail) : [];

  return (
    <Modal
      isOpen={transaction != null}
      onClose={onClose}
      title={transaction ? enumLabel(t.transactions.txTypes, transaction.type) : undefined}
      maxWidth="max-w-xl"
    >
      {transaction && (
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-4">
          <Badge variant="accent">{enumLabel(t.transactions.statuses, transaction.status)}</Badge>
          <span className="text-xs text-text-tertiary">
            {transaction.last_event_datetime ? formatDateTime(transaction.last_event_datetime) : "—"}
          </span>
          <span className="ml-auto text-sm font-semibold tabular-nums text-text-primary">
            {formatCurrency(transaction.amount ?? 0, transaction.currency || "EUR")}
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner size={24} />
        </div>
      ) : error ? (
        <div className="space-y-4 py-6 text-center">
          <p className="whitespace-pre-line text-sm text-text-secondary">{error}</p>
          <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            {t.common.retry}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="max-h-[55vh] overflow-y-auto pr-1">
            <Card>
              <DetailEntries entries={entries} currency={currency} depth={0} />
            </Card>
          </div>
          {txId && (
            <CliCommand
              commands={renderCliCommand("get_transaction_detail", { transactionId: txId, portfolioId })}
              variant="block"
            />
          )}
        </div>
      )}
    </Modal>
  );
}
