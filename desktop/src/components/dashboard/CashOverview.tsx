import Card from "../ui/Card";
import Stat from "../ui/Stat";
import { formatCurrency, formatNumber } from "../../lib/format";
import { useI18n } from "../../i18n";
import type { BrokerCashBreakdownData, OvernightData } from "../../api/types";

interface CashOverviewProps {
  cash: BrokerCashBreakdownData["result"] | null;
  overnight: OvernightData["result"] | null;
}

const num = (s?: string | null): number => {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
};

/**
 * All-Cash Overview — the composite feature this screen owns: brokerage cash
 * (`getBrokerCashBreakdown`) and the overnight savings pot (`getOvernight`)
 * are two different backends/API calls, but from the user's point of view
 * both are just "my cash", so they are folded into one headline figure with
 * the underlying breakdown shown right beneath it.
 */
export default function CashOverview({ cash, overnight }: CashOverviewProps) {
  const { t } = useI18n();

  const cashBalance = num(cash?.cash_balance);
  const buyingPower = num(cash?.buying_power);
  const pendingBuy = num(cash?.pending_buy_orders_amount);
  const possibleTaxes = num(cash?.possible_taxes);
  const overnightBalance = num(overnight?.balance);
  const rate = overnight?.interest_rate ? num(overnight.interest_rate) * 100 : null;
  const allCash = cashBalance + overnightBalance;

  // dashboard.buyingPower is a whole-sentence template ("Buying power {x}");
  // called with an empty value it yields just the label prefix.
  const buyingPowerLabel = t.dashboard.buyingPower("").trim();

  return (
    <section className="border-b border-border pb-8">
      <Stat
        size="lg"
        label={`${t.dashboard.cashBalance} + ${t.dashboard.overnightSavings}`}
        value={formatCurrency(allCash)}
      />
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <Stat label={t.dashboard.cashBalance} value={formatCurrency(cashBalance)} />
        </Card>
        <Card className="p-4">
          <Stat
            label={buyingPowerLabel}
            value={formatCurrency(buyingPower)}
            sub={pendingBuy > 0 ? `${t.orders.title}: ${formatCurrency(pendingBuy)}` : undefined}
          />
        </Card>
        <Card className="p-4">
          <Stat
            label={t.dashboard.overnightSavings}
            value={formatCurrency(overnightBalance)}
            delta={rate != null ? { text: `${formatNumber(rate)}% p.a.`, positive: true } : undefined}
            sub={rate == null ? t.dashboard.rateUnavailable : undefined}
          />
        </Card>
        <Card className="p-4">
          <Stat label={t.reports.taxes} value={formatCurrency(possibleTaxes)} />
        </Card>
      </div>
    </section>
  );
}
