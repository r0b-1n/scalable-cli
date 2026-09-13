import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import type { OrderType, QuoteData, TradePreviewData, TradeSide, TradeSubmitData } from "../../api/types";
import Modal from "../ui/Modal";
import OrderEntryForm from "./OrderEntryForm";
import DisclosureView from "./DisclosureView";
import ResultView from "./ResultView";

type TradeStep = "entry" | "disclosure" | "result";
type PreviewArgs = Parameters<typeof api.tradePreview>[0];

const ISIN_PATTERN = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/;

/**
 * The trade ticket. Three explicit steps, matching the CLI's own two-phase
 * flow plus a result screen:
 *  1. entry     — build the order, see a live quote.
 *  2. disclosure — `trade_preview` output rendered in full; the user reviews
 *     it, nothing is submitted yet.
 *  3. result     — only reached after the user presses the phase-2 button.
 */
export default function TradeModal() {
  const { tradeModalOpen, tradeModalSide, tradeModalIsin, tradeModalPrefill, activePortfolioId, closeTradeModal } =
    useAppStore();
  const { t } = useI18n();

  const [step, setStep] = useState<TradeStep>("entry");
  const [side, setSide] = useState<TradeSide>("buy");
  const [isin, setIsin] = useState("");
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [venue, setVenue] = useState("");

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TradePreviewData | null>(null);
  const [previewArgs, setPreviewArgs] = useState<PreviewArgs | null>(null);
  const [acceptUnsuitable, setAcceptUnsuitable] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<TradeSubmitData | null>(null);

  // Synchronous in-flight guard: `disabled={loading}` only applies after a
  // re-render, so a fast double-activation could call the CLI twice.
  const inFlight = useRef(false);

  const resetForm = useCallback(() => {
    setStep("entry");
    setSide(tradeModalSide);
    setIsin(tradeModalIsin || "");
    setAmount(tradeModalSide === "buy" ? tradeModalPrefill?.amount || "" : "");
    setShares(tradeModalPrefill?.shares || "");
    setOrderType("market");
    setLimitPrice("");
    setStopPrice("");
    setVenue("");
    setQuote(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setPreview(null);
    setPreviewArgs(null);
    setAcceptUnsuitable(false);
    setSubmitting(false);
    setSubmitError(null);
    setResult(null);
  }, [tradeModalSide, tradeModalIsin, tradeModalPrefill]);

  // Fresh state every time the ticket opens; a close mid-flow must never
  // leave a stale preview or confirmation id lying around for next time.
  useEffect(() => {
    if (tradeModalOpen) resetForm();
  }, [tradeModalOpen, resetForm]);

  // Sell has no `--amount` on the CLI — clear it defensively if the side
  // toggle flips after an amount was typed while buying.
  useEffect(() => {
    if (side === "sell") setAmount("");
  }, [side]);

  // Live quote, debounced, only once the field holds something ISIN-shaped.
  useEffect(() => {
    const clean = isin.trim().toUpperCase();
    if (!tradeModalOpen || !ISIN_PATTERN.test(clean)) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.getQuote(clean, { portfolioId: activePortfolioId || undefined });
        if (!cancelled) setQuote(data);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isin, tradeModalOpen, activePortfolioId]);

  const handleClose = () => {
    resetForm();
    closeTradeModal();
  };

  const handleAmountChange = (v: string) => {
    setAmount(v);
    if (v) setShares("");
  };
  const handleSharesChange = (v: string) => {
    setShares(v);
    if (v) setAmount("");
  };

  const buildPreviewArgs = (): PreviewArgs => ({
    side,
    isin: isin.trim(),
    amount: side === "buy" ? amount.trim() || undefined : undefined,
    shares: shares.trim() || undefined,
    orderType,
    limitPrice: orderType === "limit" ? limitPrice.trim() || undefined : undefined,
    stopPrice: orderType === "stop" ? stopPrice.trim() || undefined : undefined,
    venue: venue.trim() || undefined,
  });

  const canPreview =
    isin.trim().length > 0 &&
    (side === "buy" ? Boolean(amount.trim() || shares.trim()) : Boolean(shares.trim())) &&
    (orderType !== "limit" || limitPrice.trim().length > 0) &&
    (orderType !== "stop" || stopPrice.trim().length > 0);

  const handlePreview = async () => {
    if (inFlight.current || !canPreview) return;
    inFlight.current = true;
    setPreviewLoading(true);
    setPreviewError(null);
    const args = buildPreviewArgs();
    try {
      const data = await api.tradePreview(args);
      if (!data?.confirmation?.id) {
        setPreviewError(t.trade.missingConfirmation);
        return;
      }
      setPreview(data);
      setPreviewArgs(args);
      setAcceptUnsuitable(false);
      setStep("disclosure");
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : t.trade.previewFailed);
    } finally {
      inFlight.current = false;
      setPreviewLoading(false);
    }
  };

  // Phase 2 — fires only from the explicit button `DisclosureView` renders,
  // never automatically, and always repeats the exact phase-1 arguments.
  const handleSubmit = async () => {
    if (inFlight.current || !preview || !previewArgs) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const data = await api.tradeSubmit({
        ...previewArgs,
        confirmationId: preview.confirmation.id,
        ...(side === "buy" ? { acceptUnsuitable } : {}),
      });
      setResult(data);
      setStep("result");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t.trade.tradeFailed);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const midPrice = quote?.result?.quote_mid_price;
  const estimatedShares =
    side === "buy" && amount.trim() && midPrice ? parseFloat(amount) / midPrice : null;

  return (
    <Modal
      isOpen={tradeModalOpen}
      onClose={handleClose}
      title={side === "buy" ? t.trade.buyOrder : t.trade.sellOrder}
      maxWidth="max-w-2xl"
    >
      {step === "entry" && (
        <OrderEntryForm
          side={side}
          onSideChange={setSide}
          isin={isin}
          onIsinChange={setIsin}
          amount={amount}
          onAmountChange={handleAmountChange}
          shares={shares}
          onSharesChange={handleSharesChange}
          orderType={orderType}
          onOrderTypeChange={setOrderType}
          limitPrice={limitPrice}
          onLimitPriceChange={setLimitPrice}
          stopPrice={stopPrice}
          onStopPriceChange={setStopPrice}
          venue={venue}
          onVenueChange={setVenue}
          quote={quote}
          quoteLoading={quoteLoading}
          estimatedShares={estimatedShares}
          previewArgs={buildPreviewArgs()}
          previewError={previewError}
          previewLoading={previewLoading}
          canPreview={canPreview}
          portfolioId={activePortfolioId || undefined}
          onPreview={handlePreview}
          onClose={handleClose}
        />
      )}

      {step === "disclosure" && preview && previewArgs && (
        <DisclosureView
          side={side}
          preview={preview}
          previewArgs={previewArgs}
          acceptUnsuitable={acceptUnsuitable}
          onAcceptUnsuitableChange={setAcceptUnsuitable}
          onBack={() => setStep("entry")}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={submitError}
        />
      )}

      {step === "result" && result && (
        <ResultView side={side} isin={isin.trim()} result={result} onClose={handleClose} />
      )}
    </Modal>
  );
}
