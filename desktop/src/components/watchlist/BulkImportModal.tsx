import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import CliCommand from "../ui/CliCommand";
import { renderCliCommand } from "../../lib/cliLog";
import { useI18n } from "../../i18n";
import { api } from "../../api/client";
import { ISIN_PATTERN } from "./watchlistLib";

interface BulkImportModalProps {
  open: boolean;
  onClose: () => void;
  portfolioId?: string;
  onDone: () => void;
}

type RowStatus = "pending" | "resolving" | "success" | "error";
interface BulkRow {
  isin: string;
  status: RowStatus;
  name?: string;
  message?: string;
}

/** Splits pasted text into candidate ISIN tokens: any run of whitespace,
 * commas or semicolons separates entries; duplicates and blanks are dropped. */
function parseIsins(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const isin = raw.trim().toUpperCase();
    if (!isin || seen.has(isin)) continue;
    seen.add(isin);
    out.push(isin);
  }
  return out;
}

/**
 * Bulk import: paste many ISINs, resolve each one with `sc broker search`
 * (confirming it actually exists rather than trusting the pasted text), then
 * add each resolved security to the watchlist — one row of feedback per ISIN.
 */
export default function BulkImportModal({ open, onClose, portfolioId, onDone }: BulkImportModalProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);

  const reset = () => {
    setText("");
    setRows([]);
    setRunning(false);
    setStarted(false);
  };

  const close = () => {
    if (running) return;
    const hadRun = started;
    reset();
    onClose();
    if (hadRun) onDone();
  };

  const candidates = parseIsins(text);

  const run = async () => {
    if (candidates.length === 0 || running) return;
    setStarted(true);
    setRunning(true);
    setRows(candidates.map((isin) => ({ isin, status: "pending" })));

    for (let i = 0; i < candidates.length; i++) {
      const isin = candidates[i];
      const setRow = (patch: Partial<BulkRow>) =>
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

      if (!ISIN_PATTERN.test(isin)) {
        setRow({ status: "error", message: t.security.notFound });
        continue;
      }
      setRow({ status: "resolving" });
      try {
        const found = await api.search(isin, { portfolioId });
        const match = found.result?.items?.find((it) => it.isin.toUpperCase() === isin);
        if (!match) {
          setRow({ status: "error", message: t.security.notFound });
          continue;
        }
        await api.addToWatchlist(isin, portfolioId);
        setRow({ status: "success", name: match.name });
      } catch (err) {
        setRow({ status: "error", message: err instanceof Error ? err.message : t.common.actionFailed });
      }
    }
    setRunning(false);
  };

  return (
    <Modal isOpen={open} onClose={close} title={t.watchlist.bulkImport} maxWidth="max-w-lg">
      <div className="space-y-4">
        {!started ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t.watchlist.isinPlaceholder}
              rows={6}
              className="w-full resize-y rounded-lg border border-border-strong bg-bg-inset p-3 font-mono text-sm text-text-primary placeholder:font-sans placeholder:text-text-tertiary focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none"
            />
            {candidates.length > 0 && (
              <p className="text-2xs text-text-tertiary">{t.portfolio.selectedCount(candidates.length)}</p>
            )}
            <CliCommand commands={renderCliCommand("add_to_watchlist", { isin: "<isin>", portfolioId })} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                {t.common.cancel}
              </Button>
              <Button onClick={run} disabled={candidates.length === 0}>
                {t.common.add}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="max-h-80 space-y-0.5 overflow-y-auto">
              {rows.map((r) => (
                <div
                  key={r.isin}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text-primary">{r.name || r.isin}</p>
                    {r.name && <p className="text-2xs text-text-tertiary">{r.isin}</p>}
                    {r.message && <p className="text-2xs text-negative">{r.message}</p>}
                  </div>
                  <div className="shrink-0">
                    {r.status === "pending" || r.status === "resolving" ? (
                      <Loader2 size={16} className="animate-spin text-text-tertiary" />
                    ) : r.status === "success" ? (
                      <CheckCircle2 size={16} className="text-positive" />
                    ) : (
                      <XCircle size={16} className="text-negative" />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={close} disabled={running}>
                {running ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
                {t.common.close}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
