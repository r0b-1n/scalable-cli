import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, ClipboardList } from "lucide-react";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import EmptyState from "../ui/EmptyState";
import { Table, THead, TH, TR, TD } from "../ui/Table";
import { useAppStore } from "../../store/appStore";
import { formatCurrency } from "../../lib/format";
import { useI18n } from "../../i18n";
import type { Holding } from "../../api/types";
import { buildPlan, type PlanRow } from "./rebalancingUtils";

/** Trims to a sane share precision without misleading false accuracy. */
function sharesStr(n: number): string {
  return (Math.round(n * 10000) / 10000).toString();
}

interface RebalancingPlanProps {
  holdings: Holding[];
  targets: Record<string, number>;
  totalValuation: number;
  tolerance: number;
}

/**
 * Order plan (composite): per holding, the buy/sell needed to reach its
 * target while respecting the tolerance band. Purely a local calculation —
 * `t.rebalancing.derivedHint` says so — every "prepare order" action still
 * routes through the real two-phase trade ticket via `openTradeModal`.
 */
export default function RebalancingPlan({ holdings, targets, totalValuation, tolerance }: RebalancingPlanProps) {
  const { t } = useI18n();
  const { openTradeModal } = useAppStore();
  const [plan, setPlan] = useState<PlanRow[] | null>(null);

  const generate = () => setPlan(buildPlan(holdings, targets, totalValuation, tolerance));

  const rows = (plan ?? []).filter((r) => r.side !== "hold");

  const prepareOrder = (row: PlanRow) => {
    if (row.side === "buy") {
      openTradeModal("buy", row.isin, { amount: Math.abs(row.diff).toFixed(2) });
    } else if (row.side === "sell") {
      // The CLI's sell path takes `--shares`, not `--amount`; the trade
      // ticket also clears `amount` the moment the side is sell, so an
      // amount prefill here would be silently dropped.
      openTradeModal("sell", row.isin, {
        shares: row.estimatedShares != null ? sharesStr(row.estimatedShares) : undefined,
      });
    }
  };

  return (
    <Card className="space-y-4">
      <CardHeader>
        <CardTitle>{t.rebalancing.plan}</CardTitle>
        <Button size="sm" onClick={generate} disabled={holdings.length === 0}>
          {t.rebalancing.generatePlan}
        </Button>
      </CardHeader>

      {plan === null ? (
        <EmptyState icon={<ClipboardList size={20} />} title={t.rebalancing.noTargets} description={t.rebalancing.noTargetsHint} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList size={20} />} title={t.rebalancing.alreadyBalanced} description={t.rebalancing.derivedHint} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <TH>{t.portfolio.colSecurity}</TH>
              <TH align="right">{t.portfolio.colValue}</TH>
              <TH align="right">{t.rebalancing.target}</TH>
              <TH align="right">{t.rebalancing.plan}</TH>
              <TH align="right"></TH>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TR key={r.isin}>
                  <TD>
                    <p className="text-sm font-medium text-text-primary">{r.name}</p>
                    <p className="text-2xs text-text-tertiary">{r.isin}</p>
                  </TD>
                  <TD numeric>{formatCurrency(r.currentValue, r.currency)}</TD>
                  <TD numeric>{formatCurrency(r.targetValue, r.currency)}</TD>
                  <TD numeric>
                    <Badge variant={r.side === "buy" ? "positive" : "negative"}>
                      {r.side === "buy" ? <ArrowUpRight size={11} className="mr-1 inline" /> : <ArrowDownRight size={11} className="mr-1 inline" />}
                      {r.side === "buy" ? t.rebalancing.buy : t.rebalancing.sell} {formatCurrency(Math.abs(r.diff), r.currency)}
                    </Badge>
                  </TD>
                  <TD numeric>
                    <Button size="sm" variant="secondary" onClick={() => prepareOrder(r)}>
                      {t.rebalancing.previewOrder}
                    </Button>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <p className="text-xs text-text-tertiary">{t.rebalancing.derivedHint}</p>
    </Card>
  );
}
