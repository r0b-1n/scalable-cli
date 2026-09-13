import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import { CopyButton } from "../ui/CliCommand";
import { findOrderId } from "../../lib/disclosure";
import { useI18n } from "../../i18n";
import type { TradeSide, TradeSubmitData } from "../../api/types";

/** Phase-2 result: what the CLI reports after a real, explicit submit. */
export default function ResultView({
  side,
  isin,
  result,
  onClose,
}: {
  side: TradeSide;
  isin: string;
  result: TradeSubmitData;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const submission = result.result?.order_submission;
  const submitted = submission?.submitted === true;
  const orderId = findOrderId(result.result);

  return (
    <div className="space-y-5 py-2 text-center">
      <div
        className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full animate-scale-in ${
          submitted ? "bg-positive/10" : "bg-warning/10"
        }`}
      >
        {submitted ? (
          <CheckCircle2 size={24} className="text-positive" />
        ) : (
          <AlertTriangle size={24} className="text-warning" />
        )}
      </div>
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{t.trade.orderSubmitted}</h3>
        {orderId && (
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm tabular-nums text-text-secondary">
            {t.trade.orderId(orderId)}
            <CopyButton value={orderId} />
          </p>
        )}
      </div>
      <div className="divide-y divide-border text-left">
        <div className="flex items-center justify-between py-2.5">
          <span className="text-sm text-text-secondary">{t.trade.statusLabel}</span>
          <Badge variant={submitted ? "positive" : "warning"}>
            {submitted ? t.trade.statusSubmitted : t.trade.statusPending}
          </Badge>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <span className="text-sm text-text-secondary">{t.trade.rowSecurity}</span>
          <span className="text-sm font-medium text-text-primary">{isin}</span>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <span className="text-sm text-text-secondary">{t.trade.rowSide}</span>
          <Badge variant={side === "buy" ? "positive" : "negative"}>
            {side === "buy" ? t.trade.sideBuy : t.trade.sideSell}
          </Badge>
        </div>
        {submission?.reason && (
          <div className="py-2.5">
            <p className="whitespace-pre-line text-xs text-text-secondary">{submission.reason}</p>
          </div>
        )}
      </div>
      <Button onClick={onClose} className="w-full" size="lg">
        {t.trade.done}
      </Button>
    </div>
  );
}
