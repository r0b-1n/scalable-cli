import { Copy, RefreshCw } from "lucide-react";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import { Table, THead, TH, TR, TD } from "../ui/Table";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Badge from "../ui/Badge";
import { cn } from "../../lib/utils";
import { formatCurrency, formatNumber } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import type { Holding } from "../../api/types";

interface RebalancingTableProps {
  holdings: Holding[];
  targets: Record<string, number>;
  onTargetChange: (isin: string, pct: number) => void;
  totalValuation: number;
  tolerance: number;
  onToleranceChange: (v: number) => void;
  onEqualWeight: () => void;
  onUseCurrent: () => void;
}

/**
 * Target vs actual vs drift, one row per holding. Rows outside the tolerance
 * band are tinted so they stand out without needing a separate legend.
 * "Equal weight" and "Use current" have no CLI/API equivalent (this is a
 * purely local planning tool) and no dedicated translation yet, so their
 * labels go through the same enum-style fallback formatter the rest of the
 * app uses for an unmapped code — flagged in the build report.
 */
export default function RebalancingTable({
  holdings,
  targets,
  onTargetChange,
  totalValuation,
  tolerance,
  onToleranceChange,
  onEqualWeight,
  onUseCurrent,
}: RebalancingTableProps) {
  const { t } = useI18n();

  const sumPct = Object.values(targets).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const sumValid = Math.abs(sumPct - 100) < 0.05;

  return (
    <Card className="space-y-4">
      <CardHeader>
        <CardTitle>{t.rebalancing.title}</CardTitle>
      </CardHeader>

      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onUseCurrent}>
          <Copy size={13} className="mr-1.5" />
          {t.rebalancing.useCurrent}
        </Button>
        <Button variant="secondary" size="sm" onClick={onEqualWeight}>
          <RefreshCw size={13} className="mr-1.5" />
          {t.rebalancing.equalWeight}
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-text-secondary">{t.rebalancing.tolerance}</span>
          <Input
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={tolerance}
            onChange={(e) => onToleranceChange(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
            className="h-8 w-20 text-right"
          />
          <span className="text-xs text-text-tertiary">%</span>
        </div>
      </div>

      {holdings.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-secondary">{t.rebalancing.noTargets}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <TH>{t.portfolio.colSecurity}</TH>
              <TH align="right">{t.rebalancing.actual}</TH>
              <TH align="right">{t.rebalancing.target}</TH>
              <TH align="right">{t.rebalancing.drift}</TH>
            </THead>
            <tbody>
              {holdings.map((h) => {
                const actualPct = totalValuation > 0 ? ((h.valuation ?? 0) / totalValuation) * 100 : 0;
                const targetPct = targets[h.isin] ?? 0;
                const driftPct = actualPct - targetPct;
                const outOfBand = Math.abs(driftPct) > tolerance;
                return (
                  <TR key={h.isin} className={cn(outOfBand && "bg-warning/5")}>
                    <TD>
                      <p className="text-sm font-medium text-text-primary">{h.name || h.isin}</p>
                      <p className="text-2xs text-text-tertiary">{h.isin}</p>
                    </TD>
                    <TD numeric>
                      <p className="font-medium tabular-nums">{formatNumber(actualPct)}%</p>
                      <p className="text-2xs text-text-tertiary tabular-nums">
                        {formatCurrency(h.valuation ?? 0, h.valuation_currency)}
                      </p>
                    </TD>
                    <TD numeric>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={targetPct}
                        onChange={(e) => onTargetChange(h.isin, Math.max(0, Number(e.target.value) || 0))}
                        className="h-8 w-24 text-right tabular-nums"
                        aria-label={`${t.rebalancing.target} ${h.isin}`}
                      />
                    </TD>
                    <TD numeric>
                      <span className={outOfBand ? "font-medium text-warning" : "text-text-secondary"}>
                        {driftPct >= 0 ? "+" : ""}
                        {formatNumber(driftPct)}%
                      </span>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-text-secondary">
          {t.rebalancing.totalValue}: <span className="tabular-nums">{formatCurrency(totalValuation)}</span>
        </span>
        <div className="flex items-center gap-2">
          {!sumValid && <Badge variant="warning">{t.rebalancing.sumMustBe100}</Badge>}
          <span className="text-xs tabular-nums text-text-tertiary">
            {t.rebalancing.target} {formatNumber(sumPct)}%
          </span>
        </div>
      </div>
    </Card>
  );
}
