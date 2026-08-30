import { useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import Spinner from "../ui/Spinner";
import Badge from "../ui/Badge";
import { formatCurrency } from "../../lib/format";
import { AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";

type TradeStep = "form" | "preview" | "result";

export default function TradeModal() {
  const { tradeModalOpen, tradeModalSide, tradeModalIsin, closeTradeModal } = useAppStore();
  const [step, setStep] = useState<TradeStep>("form");
  const [isin, setIsin] = useState(tradeModalIsin || "");
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [orderType, setOrderType] = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const isBuy = tradeModalSide === "buy";

  const handlePreview = async () => {
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
      setError(err?.message || "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.tradeSubmit({
        side: tradeModalSide,
        confirmationId: preview.confirmationId,
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
      setError(err?.message || "Trade failed");
    } finally {
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

  const orderTypes = [
    { value: "market", label: "Market" },
    { value: "limit", label: "Limit" },
    { value: "stop", label: "Stop" },
  ];

  return (
    <Modal
      isOpen={tradeModalOpen}
      onClose={handleClose}
      title={isBuy ? "Buy Order" : "Sell Order"}
    >
      {step === "form" && (
        <div className="space-y-4">
          <Input
            label="ISIN"
            placeholder="e.g. US0378331005"
            value={isin}
            onChange={(e) => setIsin(e.target.value)}
            disabled={!!tradeModalIsin}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Amount (EUR)"
              type="number"
              placeholder="e.g. 500"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setShares("");
              }}
            />
            <Input
              label="Shares"
              type="number"
              placeholder={isBuy ? "Whole shares" : "Shares to sell"}
              value={shares}
              onChange={(e) => {
                setShares(e.target.value);
                setAmount("");
              }}
            />
          </div>
          <Select
            label="Order Type"
            options={orderTypes}
            value={orderType}
            onChange={(e) => setOrderType(e.target.value)}
          />
          {orderType === "limit" && (
            <Input
              label="Limit Price"
              type="number"
              placeholder="e.g. 150.00"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
            />
          )}
          {orderType === "stop" && (
            <Input
              label="Stop Price"
              type="number"
              placeholder="e.g. 140.00"
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
              Cancel
            </Button>
            <Button onClick={handlePreview} disabled={loading || !isin.trim()}>
              {loading ? <Spinner size={16} className="mr-2" /> : <ArrowRight size={16} className="mr-2" />}
              Preview Order
            </Button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="p-4 bg-bg-primary rounded-xl border border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Security</span>
              <span className="text-sm font-medium text-text-primary">{isin}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Side</span>
              <Badge variant={isBuy ? "positive" : "negative"}>
                {isBuy ? "BUY" : "SELL"}
              </Badge>
            </div>
            {preview.quantity && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Quantity</span>
                <span className="text-sm font-medium text-text-primary">{preview.quantity}</span>
              </div>
            )}
            {preview.amount && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Amount</span>
                <span className="text-sm font-medium text-text-primary">{preview.amount}</span>
              </div>
            )}
            {preview.price && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Price</span>
                <span className="text-sm font-medium text-text-primary">{preview.price}</span>
              </div>
            )}
            {preview.totalCost && (
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-sm font-medium text-text-secondary">Total</span>
                <span className="text-base font-bold text-text-primary">{preview.totalCost}</span>
              </div>
            )}
          </div>

          {preview.warnings && preview.warnings.length > 0 && (
            <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
                <div>
                  {preview.warnings.map((w: string, i: number) => (
                    <p key={i} className="text-xs text-warning">{w}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-negative/10 border border-negative/20 rounded-lg">
              <p className="text-xs text-negative">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant={isBuy ? "primary" : "danger"}
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? <Spinner size={16} className="mr-2" /> : <CheckCircle size={16} className="mr-2" />}
              {isBuy ? "Confirm Buy" : "Confirm Sell"}
            </Button>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="space-y-4 text-center py-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-positive/15 flex items-center justify-center">
            <CheckCircle size={24} className="text-positive" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Order Submitted</h3>
            <p className="text-sm text-text-secondary mt-1">
              Order ID: {result.orderId}
            </p>
          </div>
          <div className="p-3 bg-bg-primary rounded-xl border border-border text-left space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-text-secondary">Status</span>
              <Badge variant="positive">{result.status}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-text-secondary">Security</span>
              <span className="text-sm font-medium text-text-primary">{result.isin}</span>
            </div>
            {result.quantity && (
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Quantity</span>
                <span className="text-sm font-medium text-text-primary">{result.quantity}</span>
              </div>
            )}
          </div>
          <Button onClick={handleClose} className="w-full">
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
