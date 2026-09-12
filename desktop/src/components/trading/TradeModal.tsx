import { useRef, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import SegmentedControl from "../ui/SegmentedControl";
import Spinner from "../ui/Spinner";
import Badge from "../ui/Badge";
import { formatCurrency } from "../../lib/format";
import { useI18n } from "../../i18n";
import { AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";

type TradeStep = "form" | "preview" | "result";
type OrderType = "market" | "limit" | "stop";

function Row({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-text-secondary">{label}</span>
      <span
        className={`text-sm tabular-nums ${strong ? "font-semibold text-text-primary" : "font-medium text-text-primary"}`}
      >
        {value}
      </span>
    </div>
  );
}

export default function TradeModal() {
  const { tradeModalOpen, tradeModalSide, tradeModalIsin, closeTradeModal } = useAppStore();
  const { t } = useI18n();
  const [step, setStep] = useState<TradeStep>("form");
  const [isin, setIsin] = useState(tradeModalIsin || "");
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // Synchronous in-flight guard: `disabled={loading}` only applies after a
  // re-render, so a fast double-activation could submit an order twice.
  const inFlight = useRef(false);

  const isBuy = tradeModalSide === "buy";

  const handlePreview = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await api.tradePreview({
        side: tradeModalSide,
        isin: isin.trim(),
        amount: amount || undefined,
        shares: shares || undefined,
        orderType,
        limitPrice: limitPrice || undefined,
        stopPrice: stopPrice || undefined,
      });
      setPreview(data);
      setStep("preview");
    } catch (err: any) {
      setError(err?.message || t.trade.previewFailed);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (inFlight.current) return;
    // sc's two-phase trade flow: repeat the command with --confirm <id>.
    const confirmationId = (preview as any)?.confirmation?.id;
    if (!confirmationId) {
      setError(t.trade.missingConfirmation);
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await api.tradeSubmit({
        side: tradeModalSide,
        confirmationId,
        isin: isin.trim(),
        amount: amount || undefined,
        shares: shares || undefined,
        orderType,
        limitPrice: limitPrice || undefined,
        stopPrice: stopPrice || undefined,
      });
      setResult(data);
      setStep("result");
    } catch (err: any) {
      setError(err?.message || t.trade.tradeFailed);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep("form");
    setPreview(null);
    setResult(null);
    setError(null);
    setAmount("");
    setShares("");
    setLimitPrice("");
    setStopPrice("");
    closeTradeModal();
  };

  const pv = (preview as any)?.result;
  const quoteCurrency = pv?.market_quote?.currency || "EUR";
  const submission = (result as any)?.result?.order_submission;

  return (
    <Modal
      isOpen={tradeModalOpen}
      onClose={handleClose}
      title={isBuy ? t.trade.buyOrder : t.trade.sellOrder}
    >
      {step === "form" && (
        <div className="space-y-4">
          <Input
            label={t.trade.isinLabel}
            placeholder={t.trade.isinPlaceholder}
            value={isin}
            onChange={(e) => setIsin(e.target.value)}
            disabled={!!tradeModalIsin}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t.trade.amountLabel}
              type="number"
              placeholder={t.trade.amountPlaceholder}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setShares("");
              }}
            />
            <Input
              label={t.trade.sharesLabel}
              type="number"
              placeholder={isBuy ? t.trade.sharesPlaceholderBuy : t.trade.sharesPlaceholderSell}
              value={shares}
              onChange={(e) => {
                setShares(e.target.value);
                setAmount("");
              }}
            />
          </div>
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-text-secondary">{t.trade.orderType}</span>
            <SegmentedControl<OrderType>
              options={[
                { value: "market", label: t.trade.market },
                { value: "limit", label: t.trade.limit },
                { value: "stop", label: t.trade.stop },
              ]}
              value={orderType}
              onChange={setOrderType}
            />
          </div>
          {orderType === "limit" && (
            <Input
              label={t.trade.limitPrice}
              type="number"
              placeholder={t.trade.limitPlaceholder}
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
            />
          )}
          {orderType === "stop" && (
            <Input
              label={t.trade.stopPrice}
              type="number"
              placeholder={t.trade.stopPlaceholder}
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
            />
          )}
          {error && (
            <div className="p-3 bg-negative/10 border border-negative/20 rounded-lg">
              <p className="text-xs text-negative">{error}</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={handleClose}>
              {t.common.cancel}
            </Button>
            <Button onClick={handlePreview} disabled={loading || !isin.trim()}>
              {loading ? <Spinner size={16} className="mr-2" /> : <ArrowRight size={16} className="mr-2" />}
              {t.trade.previewOrder}
            </Button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="divide-y divide-border">
            <Row label={t.trade.rowSecurity} value={isin} />
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm text-text-secondary">{t.trade.rowSide}</span>
              <Badge variant={isBuy ? "positive" : "negative"}>{isBuy ? t.trade.sideBuy : t.trade.sideSell}</Badge>
            </div>
            {pv?.calculation?.shares && <Row label={t.trade.rowShares} value={pv.calculation.shares} />}
            {pv?.calculation?.estimate_price && (
              <Row
                label={t.trade.rowEstPrice}
                value={formatCurrency(parseFloat(pv.calculation.estimate_price), quoteCurrency)}
              />
            )}
            {pv?.market_quote?.mid_price && (
              <Row
                label={t.trade.rowMarketQuote}
                value={formatCurrency(parseFloat(pv.market_quote.mid_price), quoteCurrency)}
              />
            )}
            {pv?.calculation?.estimated_order_volume && (
              <Row
                label={t.trade.rowEstTotal}
                strong
                value={formatCurrency(parseFloat(pv.calculation.estimated_order_volume), quoteCurrency)}
              />
            )}
          </div>

          {pv?.warning && (
            <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
                <div className="space-y-1">
                  {pv.warning.title && (
                    <p className="text-xs font-medium text-warning">{pv.warning.title}</p>
                  )}
                  {pv.warning.body && <p className="text-xs text-warning/90">{pv.warning.body}</p>}
                </div>
              </div>
            </div>
          )}

          {(pv?.price_warnings?.items ?? []).length > 0 && (
            <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg space-y-1">
              {pv.price_warnings.items.map((w: any, i: number) => (
                <p key={i} className="text-xs text-warning">
                  {typeof w === "string" ? w : (w.message ?? JSON.stringify(w))}
                </p>
              ))}
            </div>
          )}

          {error && (
            <div className="p-3 bg-negative/10 border border-negative/20 rounded-lg">
              <p className="text-xs text-negative">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={handleClose}>
              {t.common.cancel}
            </Button>
            <Button
              variant={isBuy ? "primary" : "danger"}
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? <Spinner size={16} className="mr-2" /> : <CheckCircle size={16} className="mr-2" />}
              {isBuy ? t.trade.confirmBuy : t.trade.confirmSell}
            </Button>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="space-y-4 text-center py-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-positive/10 flex items-center justify-center animate-scale-in">
            <CheckCircle size={24} className="text-positive" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{t.trade.orderSubmitted}</h3>
            {submission?.order_id && (
              <p className="text-sm text-text-secondary mt-1 tabular-nums">
                {t.trade.orderId(String(submission.order_id))}
              </p>
            )}
          </div>
          <div className="divide-y divide-border text-left">
            <div className="flex justify-between py-2.5">
              <span className="text-sm text-text-secondary">{t.trade.statusLabel}</span>
              <Badge variant={submission?.submitted ? "positive" : "warning"}>
                {submission?.submitted ? t.trade.statusSubmitted : t.trade.statusPending}
              </Badge>
            </div>
            <Row label={t.trade.rowSecurity} value={isin} />
          </div>
          <Button onClick={handleClose} className="w-full" size="lg">
            {t.trade.done}
          </Button>
        </div>
      )}
    </Modal>
  );
}
