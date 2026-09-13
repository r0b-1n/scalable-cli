import { useEffect, useState } from "react";
import { Clock, KeyRound } from "lucide-react";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";
import CliCommand, { CopyButton } from "../ui/CliCommand";
import DisclosureSection from "../ui/DisclosureSection";
import { epochToDate } from "../../lib/disclosure";
import { renderCliCommand } from "../../lib/cliLog";
import { formatDateTime } from "../../lib/format";
import { useI18n } from "../../i18n";
import type { SavingsPlanPreviewData } from "../../api/types";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

interface SavingsPlanDisclosureProps {
  preview: SavingsPlanPreviewData;
  previewArgs: Record<string, unknown>;
  acceptUnsuitable: boolean;
  onAcceptUnsuitableChange: (v: boolean) => void;
  onBack: () => void;
  onConfirm: () => void;
  confirming: boolean;
  error: string | null;
}

/**
 * The mandated phase-1 savings-plan disclosure (§4 of the build spec) — the
 * same compliance shape as the trade ticket's, just nested one level deeper
 * under `result` (see the note on `SavingsPlanPreviewData` in `api/types.ts`).
 * Every section in `presentation.section_order` is rendered in full, in
 * order, values verbatim; phase 2 only ever runs from the explicit button
 * here, never automatically.
 */
export default function SavingsPlanDisclosure({
  preview,
  previewArgs,
  acceptUnsuitable,
  onAcceptUnsuitableChange,
  onBack,
  onConfirm,
  confirming,
  error,
}: SavingsPlanDisclosureProps) {
  const { t } = useI18n();
  const { compliance, confirmation, presentation } = preview.result;
  const [now, setNow] = useState(() => Date.now());

  const expiry = epochToDate(confirmation.expires_at_epoch);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const secondsLeft = Math.max(0, Math.floor((expiry.getTime() - now) / 1000));
  const expired = secondsLeft <= 0;

  const requiresAccept = confirmation.requires_accept_unsuitable;
  // The disclosure itself carries the CLI's own copy for this acknowledgement
  // when it appears as a warning/suitability field; fall back to the raw
  // flag name only if no such field is present.
  const unsuitableLabel =
    Object.values(presentation.sections)
      .flatMap((s) => s.fields)
      .find((f) => f.path?.toLowerCase().includes("accept_unsuitable") || f.path?.toLowerCase().includes("appropriateness"))
      ?.label || confirmation.accept_unsuitable_flag || "accept_unsuitable";

  const confirmArgs = {
    ...previewArgs,
    confirm: confirmation.id,
    ...(requiresAccept
      ? {
          acknowledgedAppropriatenessWarningVersion: confirmation.warning_version ?? undefined,
          appropriatenessId: confirmation.required_fields?.appropriateness_id ?? undefined,
        }
      : {}),
  };

  const canConfirm = !confirming && !expired && (!requiresAccept || acceptUnsuitable);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-bg-card p-4">
        <div className="flex items-center gap-2 text-sm">
          <KeyRound size={15} className="shrink-0 text-text-tertiary" aria-hidden="true" />
          <span className="break-all font-mono text-text-primary">{confirmation.id}</span>
          <CopyButton value={confirmation.id} />
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
        {presentation.section_order.map((key) => {
          const section = presentation.sections[key];
          return section ? (
            <DisclosureSection
              key={key}
              section={section}
              displayNullAsLiteral={compliance.presentation.display_null_as_literal}
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
        commands={[
          renderCliCommand("add_savings_plan", previewArgs),
          renderCliCommand("add_savings_plan", confirmArgs),
        ]}
        variant="block"
      />

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onBack} disabled={confirming}>
          {t.common.previous}
        </Button>
        <Button onClick={onConfirm} disabled={!canConfirm}>
          {confirming ? <Spinner size={16} className="mr-2" /> : null}
          {t.savings.confirmCreate}
        </Button>
      </div>
    </div>
  );
}
