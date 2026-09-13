import Stat from "../ui/Stat";
import { formatCurrency, formatPercent } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import type { PerformanceEntry } from "../../api/types";

interface HeroValuationProps {
  total: number;
  performance: PerformanceEntry[];
}

/**
 * Total valuation with the day change (absolute figure from the API plus a
 * locally derived percentage) and a strip of the other reported timeframes.
 * The CLI only ever reports absolute returns (see PerformanceEntry), so the
 * secondary timeframes show amounts, not derived percentages.
 */
export default function HeroValuation({ total, performance }: HeroValuationProps) {
  const { t } = useI18n();

  const dayChange =
    performance.find((p) => p.timeframe === "ONE_DAY")?.simpleAbsoluteReturn ?? 0;
  const baseValue = total - dayChange;
  const dayChangePercent = baseValue > 0 ? (dayChange / baseValue) * 100 : 0;
  const isPositive = dayChange >= 0;
  const otherTimeframes = performance.filter((p) => p.timeframe !== "ONE_DAY");

  return (
    <section className="space-y-5 border-b border-border pb-8">
      <Stat
        size="hero"
        label={t.dashboard.portfolioValue}
        value={formatCurrency(total)}
        delta={{
          text: `${isPositive ? "+" : ""}${formatCurrency(dayChange)} · ${formatPercent(dayChangePercent)}`,
          positive: isPositive,
        }}
        sub={t.common.today}
      />
      {otherTimeframes.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {otherTimeframes.map((p) => {
            const pos = p.simpleAbsoluteReturn >= 0;
            return (
              <div key={p.timeframe} className="flex items-baseline gap-1.5">
                <span className="text-2xs uppercase tracking-wide text-text-tertiary">
                  {enumLabel(t.common.perfTimeframes, p.timeframe)}
                </span>
                <span
                  className={`text-xs font-medium tabular-nums ${
                    pos ? "text-positive" : "text-negative"
                  }`}
                >
                  {pos ? "+" : ""}
                  {formatCurrency(p.simpleAbsoluteReturn)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
