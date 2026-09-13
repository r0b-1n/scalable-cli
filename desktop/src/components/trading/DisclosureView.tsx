import { useEffect, useState } from "react";
import { Clock, KeyRound } from "lucide-react";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";
import CliCommand, { CopyButton } from "../ui/CliCommand";
import DisclosureSection from "../ui/DisclosureSection";
import { epochToDate, findFieldByPath } from "../../lib/disclosure";
import { renderCliCommand } from "../../lib/cliLog";
import { formatDateTime } from "../../lib/format";
import { useI18n } from "../../i18n";
import type { TradePreviewData, TradeSide } from "../../api/types";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

interface DisclosureViewProps {
  side: TradeSide;
  preview: TradePreviewData;
  previewArgs: Record<string, unknown>;
  acceptUnsuitable: boolean;
  onAcceptUnsuitableChange: (v: boolean) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

/**
 * The mandated phase-1 disclosure. Every section in `presentation.sections`
 * is rendered, in `section_order`, values verbatim — this is the CLI's own
 * compliance text, not a summary the app writes itself. Phase 2 (`onSubmit`)
 * only ever fires from the explicit button below; nothing here calls it
 * automatically.
 */
export default function DisclosureView({
  side,
  preview,
  previewArgs,
  acceptUnsuitable,
  onAcceptUnsuitableChange,
  onBack,
  onSubmit,
  submitting,
  error,
}: DisclosureViewProps) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  const expiry = epochToDate(preview.confirmation.expires_at_epoch);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const secondsLeft = Math.max(0, Math.floor((expiry.getTime() - now) / 1000));
  const expired = secondsLeft <= 0;

  const requiresAccept = side === "buy" && preview.confirmation.requires_accept_unsuitable;
  const unsuitableField =
    findFieldByPath(preview.presentation.sections, "accept_unsuitable") ??
    findFieldByPath(preview.presentation.sections, "requires_accept_unsuitable");
  const unsuitableLabel =
    unsuitableField?.label || preview.confirmation.accept_unsuitable_flag || "accept_unsuitable";

  const submitArgs = {
    ...previewArgs,
    confirmationId: preview.confirmation.id,
    ...(side === "buy" ? { acceptUnsuitable } : {}),
  };

  const canSubmit = !submitting && !expired && (!requiresAccept || acceptUnsuitable);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-bg-card p-4">
        <div className="flex items-center gap-2 text-sm">
          <KeyRound size={15} className="shrink-0 text-text-tertiary" aria-hidden="true" />
          <span className="break-all font-mono text-text-primary">{preview.confirmation.id}</span>
          <CopyButton value={preview.confirmation.id} />
        </div>
        <div
          className={`flex items-center gap-1.5 text-sm ${expired ? "text-negative" : "text-text-secondary"}`}
        >
          <Clock size={15} className="shrink-0" aria-hidden="true" />
          <span role="timer" aria-label={formatDateTime(expiry.toISOString())} className="tabular-nums">
            {pad2(Math.floor(secondsLeft / 60))}:{pad2(secondsLeft % 60)}
          </span>
        </div>
      </div>

      <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
        {preview.presentation.section_order.map((key) => {
          const section = preview.presentation.sections[key];
          return section ? (
            <DisclosureSection
              key={key}
              section={section}
              displayNullAsLiteral={preview.compliance.presentation.display_null_as_literal}
            />
          ) : null;
        })}
      </div>

      {requiresAccept && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3.5">
          <input
            type="checkbox"
            checked={acceptUnsuitable}
            onChange={(e) => onAcceptUnsuitableChange(e.target.checked)}
            className="mt-0.5 cursor-pointer"
          />
          <span className="text-sm text-text-primary">{unsuitableLabel}</span>
        </label>
      )}

      {error && (
        <div className="rounded-lg border border-negative/20 bg-negative/10 p-3">
          <p className="whitespace-pre-line text-xs text-negative">{error}</p>
        </div>
      )}

      <CliCommand
        commands={[renderCliCommand("trade_preview", previewArgs), renderCliCommand("trade_submit", submitArgs)]}
        variant="block"
      />

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          {t.common.previous}
        </Button>
        <Button variant={side === "buy" ? "primary" : "danger"} onClick={onSubmit} disabled={!canSubmit}>
          {submitting ? <Spinner size={16} className="mr-2" /> : null}
          {side === "buy" ? t.trade.confirmBuy : t.trade.confirmSell}
        </Button>
      </div>
    </div>
  );
}
