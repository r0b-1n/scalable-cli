import Card, { CardHeader, CardTitle } from "../ui/Card";
import DataTable, { type Column } from "../ui/DataTable";
import Badge from "../ui/Badge";
import { formatNumber } from "../../lib/format";
import { useI18n, type Translations } from "../../i18n";
import { isRecord, pickArray, pickNumber, pickString, type AnyRecord } from "./utils";

interface Row {
  key: string;
  name: string;
  value: number | undefined;
  percentage: number | undefined;
}

function toRows(items: unknown[], prefix: string): Row[] {
  return items.filter(isRecord).map((item, i) => ({
    key: `${prefix}-${i}`,
    name: pickString(item, ["name", "label", "rating", "style", "market_cap"]) ?? "—",
    value: pickNumber(item, ["value"]),
    percentage: pickNumber(item, ["percentage"]),
  }));
}

function miniColumns(t: Translations): Column<Row>[] {
  return [
    { key: "name", header: t.groups.name, cell: (r) => r.name, sortValue: (r) => r.name },
    {
      key: "percentage",
      header: "%",
      align: "right",
      cell: (r) =>
        r.percentage != null
          ? `${formatNumber(r.percentage, 1)}%`
          : r.value != null
            ? formatNumber(r.value)
            : "—",
      sortValue: (r) => r.percentage ?? r.value ?? null,
    },
  ];
}

/** `result.equity_company_styles.market_caps` — renders nothing when empty. */
export function EquityStylesCard({ data }: { data: AnyRecord | null | undefined }) {
  const { t } = useI18n();
  const rows = toRows(pickArray(data, ["market_caps"]), "cap");
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.analytics.equityStyles}</CardTitle>
      </CardHeader>
      <DataTable columns={miniColumns(t)} rows={rows} rowKey={(r) => r.key} />
    </Card>
  );
}

/**
 * `result.fixed_income_ratings` — investment/speculative/unrated grade
 * buckets, each rendered only if it actually has entries.
 */
export function FixedIncomeRatingsCard({ data }: { data: AnyRecord | null | undefined }) {
  const { t } = useI18n();
  const groups = [
    { key: "investment_grade", label: t.analytics.investmentGrade, items: pickArray(data, ["investment_grade"]) },
    { key: "speculative_grade", label: t.analytics.speculativeGrade, items: pickArray(data, ["speculative_grade"]) },
    { key: "unrated_grade", label: t.analytics.unratedGrade, items: pickArray(data, ["unrated_grade"]) },
  ].filter((g) => g.items.length > 0);

  if (groups.length === 0) return null;

  const warn = isRecord(data) && data.show_speculative_investment_warning === true;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.analytics.fixedIncome}</CardTitle>
      </CardHeader>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key}>
            <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-text-tertiary">
              {g.label}
            </p>
            <DataTable columns={miniColumns(t)} rows={toRows(g.items, g.key)} rowKey={(r) => r.key} />
          </div>
        ))}
        {warn && (
          <Badge variant="warning">{t.analytics.speculativeWarning}</Badge>
        )}
      </div>
    </Card>
  );
}
