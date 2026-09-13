import { ArrowRight } from "lucide-react";
import { formatCurrency, formatNumber } from "../../lib/format";
import { renderCliCommand } from "../../lib/cliLog";
import { useI18n } from "../../i18n";
import type { OrderType, QuoteData, TradeSide } from "../../api/types";
import Button from "../ui/Button";
import Input from "../ui/Input";
import SegmentedControl from "../ui/SegmentedControl";
import Spinner from "../ui/Spinner";
import Badge from "../ui/Badge";
import CliCommand from "../ui/CliCommand";
import IsinSearchInput from "./IsinSearchInput";
import CostWhatIf from "./CostWhatIf";

interface OrderEntryFormProps {
  side: TradeSide;
  onSideChange: (s: TradeSide) => void;
  isin: string;
  onIsinChange: (v: string) => void;
  amount: string;
  onAmountChange: (v: string) => void;
  shares: string;
  onSharesChange: (v: string) => void;
  orderType: OrderType;
  onOrderTypeChange: (v: OrderType) => void;
  limitPrice: string;
  onLimitPriceChange: (v: string) => void;
  stopPrice: string;
  onStopPriceChange: (v: string) => void;
  venue: string;
  onVenueChange: (v: string) => void;
  quote: QuoteData | null;
  quoteLoading: boolean;
  estimatedShares: number | null;
  previewArgs: Record<string, unknown>;
  previewError: string | null;
  previewLoading: boolean;
  canPreview: boolean;
  portfolioId?: string;
  onPreview: () => void;
  onClose: () => void;
}

/** Step 1: build the order and see what it would cost before previewing it. */
export default function OrderEntryForm({
  side,
  onSideChange,
  isin,
  onIsinChange,
  amount,
  onAmountChange,
  shares,
  onSharesChange,
  orderType,
  onOrderTypeChange,
  limitPrice,
  onLimitPriceChange,
  stopPrice,
  onStopPriceChange,
  venue,
  onVenueChange,
  quote,
  quoteLoading,
  estimatedShares,
  previewArgs,
  previewError,
  previewLoading,
  canPreview,
  portfolioId,
  onPreview,
  onClose,
}: OrderEntryFormProps) {
  const { t } = useI18n();
  const q = quote?.result;

  return (
    <div className="space-y-4">
      <IsinSearchInput value={isin} onChange={onIsinChange} portfolioId={portfolioId} />

      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-text-secondary">{t.trade.rowSide}</span>
        <SegmentedControl<TradeSide>
          options={[
            { value: "buy", label: t.trade.sideBuy },
            { value: "sell", label: t.trade.sideSell },
          ]}
          value={side}
          onChange={onSideChange}
        />
      </div>

      {side === "buy" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Input
              label={t.trade.amountLabel}
              type="number"
              placeholder={t.trade.amountPlaceholder}
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
            />
            {estimatedShares != null && (
              <p className="mt-1 text-2xs text-text-tertiary">
                ≈ {formatNumber(estimatedShares, 4)} {t.trade.sharesLabel}
              </p>
            )}
          </div>
          <Input
            label={t.trade.sharesLabel}
            type="number"
            placeholder={t.trade.sharesPlaceholderBuy}
            value={shares}
            onChange={(e) => onSharesChange(e.target.value)}
          />
        </div>
      ) : (
        <Input
          label={t.trade.sharesLabel}
          type="number"
          placeholder={t.trade.sharesPlaceholderSell}
          value={shares}
          onChange={(e) => onSharesChange(e.target.value)}
        />
      )}

      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-text-secondary">{t.trade.orderType}</span>
        <SegmentedControl<OrderType>
          options={[
            { value: "market", label: t.trade.market },
            { value: "limit", label: t.trade.limit },
            { value: "stop", label: t.trade.stop },
          ]}
          value={orderType}
          onChange={onOrderTypeChange}
        />
      </div>
      {orderType === "limit" && (
        <Input
          label={t.trade.limitPrice}
          type="number"
          placeholder={t.trade.limitPlaceholder}
          value={limitPrice}
          onChange={(e) => onLimitPriceChange(e.target.value)}
        />
      )}
      {orderType === "stop" && (
        <Input
          label={t.trade.stopPrice}
          type="number"
          placeholder={t.trade.stopPlaceholder}
          value={stopPrice}
          onChange={(e) => onStopPriceChange(e.target.value)}
        />
      )}

      <Input label={t.orders.venue} value={venue} onChange={(e) => onVenueChange(e.target.value)} />

      {(quoteLoading || q) && (
        <div className="space-y-2 rounded-xl border border-border bg-bg-inset p-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-2xs text-text-tertiary">{t.security.bid}</p>
              <p className="text-sm font-medium tabular-nums text-text-primary">
                {q ? formatCurrency(q.quote_bid_price, q.quote_currency) : <Spinner size={13} />}
              </p>
            </div>
            <div>
              <p className="text-2xs text-text-tertiary">{t.security.chartPrice}</p>
              <p className="text-sm font-semibold tabular-nums text-text-primary">
                {q ? formatCurrency(q.quote_mid_price, q.quote_currency) : <Spinner size={13} />}
              </p>
            </div>
            <div>
              <p className="text-2xs text-text-tertiary">{t.security.ask}</p>
              <p className="text-sm font-medium tabular-nums text-text-primary">
                {q ? formatCurrency(q.quote_ask_price, q.quote_currency) : <Spinner size={13} />}
              </p>
            </div>
          </div>
          {q?.quote_is_outdated && <Badge variant="warning">{t.security.quoteOutdated}</Badge>}
        </div>
      )}

      <CostWhatIf side={side} isin={isin} orderType={orderType} limitPrice={limitPrice} stopPrice={stopPrice} venue={venue} />

      {previewError && (
        <div className="rounded-lg border border-negative/20 bg-negative/10 p-3">
          <p className="whitespace-pre-line text-xs text-negative">{previewError}</p>
        </div>
      )}

      <CliCommand commands={renderCliCommand("trade_preview", previewArgs)} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose}>
          {t.common.cancel}
        </Button>
        <Button onClick={onPreview} disabled={previewLoading || !canPreview}>
          {previewLoading ? <Spinner size={16} className="mr-2" /> : <ArrowRight size={16} className="mr-2" />}
          {t.trade.previewOrder}
        </Button>
      </div>
    </div>
  );
}
