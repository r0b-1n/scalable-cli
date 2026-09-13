import Card, { CardHeader, CardTitle } from "../ui/Card";
import AllocationBar from "../ui/AllocationBar";
import DataTable, { type Column } from "../ui/DataTable";
import { chartTheme } from "../../lib/chartTheme";
import { formatCurrency, formatNumber } from "../../lib/format";
import { prettifyEnum, useI18n, type Translations } from "../../i18n";
import type { AllocationEntry } from "../../api/types";
import { pickNumber, pickString } from "./utils";

interface AllocRow {
  key: string;
  name: string;
  value: number | undefined;
  percentage: number | undefined;
}

function dimensionTitle(t: Translations, dimension: string): string {
  switch (dimension.toUpperCase()) {
    case "ASSET_CLASS":
      return t.analytics.byAssetClass;
    case "SECTOR":
      return t.analytics.bySector;
    case "REGION":
      return t.analytics.byRegion;
    case "CURRENCY":
      return t.analytics.byCurrency;
    default:
      // Unknown dimension codes still render, just prettified.
      return prettifyEnum(dimension);
  }
}

/**
 * One dimension of `getBrokerAnalytics().result.allocations` (e.g. all the
 * ASSET_CLASS entries): a proportion bar plus the underlying name/value/%
 * table. `AllocationEntry` is intentionally loosely typed — the API forwards
 * whichever fields the backend attached — so every field is read defensively.
 */
export default function AllocationDimensionCard({
  dimension,
  entries,
}: {
  dimension: string;
  entries: AllocationEntry[];
}) {
  const { t } = useI18n();
  const series = chartTheme().series;

  // Each allocation entry is one whole dimension; the rows the user sees are
  // its `positions[]` (name + valuation + weight). Older/other backends may
  // put those fields directly on the entry, so fall back to that shape.
  const positions = entries.flatMap((e) => {
    const nested = Array.isArray(e?.positions) ? e.positions : null;
    return nested && nested.length > 0 ? nested : [e as Record<string, unknown>];
  });

  const rows: AllocRow[] = positions.map((p, i) => {
    // `weight` is a 0..1 fraction; `percentage` (when present) is already 0..100.
    const weight = pickNumber(p, ["weight"]);
    const percentage = pickNumber(p, ["percentage"]) ?? (weight != null ? weight * 100 : undefined);
    return {
      key: `${dimension}-${pickString(p, ["id"]) ?? i}`,
      name: pickString(p, ["name", "label"]) ?? "—",
      value: pickNumber(p, ["valuation", "value"]),
      percentage,
    };
  });

  const slices = rows
    .map((r, i) => ({
      label: r.name,
      value: r.value ?? r.percentage ?? 0,
      color: series[i % series.length],
    }))
    .filter((s) => s.value > 0);

  const columns: Column<AllocRow>[] = [
    {
      key: "name",
      header: t.groups.name,
      cell: (r) => r.name,
      sortValue: (r) => r.name,
    },
    {
      key: "value",
      header: t.groups.valuation,
      align: "right",
      cell: (r) => (r.value != null ? formatCurrency(r.value) : "—"),
      sortValue: (r) => r.value ?? null,
    },
    {
      key: "percentage",
      header: "%",
      align: "right",
      cell: (r) => (r.percentage != null ? `${formatNumber(r.percentage, 1)}%` : "—"),
      sortValue: (r) => r.percentage ?? null,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dimensionTitle(t, dimension)}</CardTitle>
      </CardHeader>
      {slices.length > 0 && <AllocationBar slices={slices} className="mb-4" />}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} />
    </Card>
  );
}
