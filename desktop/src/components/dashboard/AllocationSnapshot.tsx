import { CardHeader, CardTitle } from "../ui/Card";
import AllocationBar from "../ui/AllocationBar";
import { chartTheme } from "../../lib/chartTheme";
import { enumLabel, useI18n } from "../../i18n";
import type { Holding } from "../../api/types";

/**
 * Quick asset-mix snapshot derived from `getHoldings` valuations, grouped by
 * `security_type` (the one dimension already present on every holding row).
 * The full breakdown by asset class / sector / region / currency lives on
 * the Analytics screen, which reads `getBrokerAnalytics` instead.
 */
export default function AllocationSnapshot({ holdings }: { holdings: Holding[] }) {
  const { t } = useI18n();
  if (holdings.length === 0) return null;

  const byType = new Map<string, number>();
  for (const h of holdings) {
    const key = h.security_type || "OTHER";
    byType.set(key, (byType.get(key) ?? 0) + Math.max(0, h.valuation ?? 0));
  }

  const series = chartTheme().series;
  const slices = Array.from(byType.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, value], i) => ({
      label: enumLabel(t.common.securityTypes, type),
      value,
      color: series[i % series.length],
    }));

  if (slices.every((s) => s.value <= 0)) return null;

  return (
    <section>
      <CardHeader>
        <CardTitle>{t.portfolio.tabAllocation}</CardTitle>
      </CardHeader>
      <AllocationBar slices={slices} />
    </section>
  );
}
