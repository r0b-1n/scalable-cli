import Card, { CardHeader, CardTitle } from "../ui/Card";
import Badge from "../ui/Badge";
import { formatNumber } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import { pickBoolean, pickString, remainingEntries, type AnyRecord } from "./utils";

type BadgeVariant = "default" | "accent" | "positive" | "negative" | "warning";

const TITLE_KEYS = ["name", "title", "label", "isin", "check", "id", "scenario", "code"];
const STATUS_KEYS = ["status", "severity", "level", "result"];
const DESCRIPTION_KEYS = ["message", "description", "detail", "details", "summary", "reason", "explanation"];
const PASSED_KEYS = ["passed", "ok", "is_healthy", "success"];

function severityVariant(status: string | undefined, passed: boolean | undefined): BadgeVariant {
  if (passed === true) return "positive";
  if (passed === false) return "negative";
  if (!status) return "default";
  const s = status.toUpperCase();
  if (/PASS|OK|GOOD|HEALTHY|SUCCESS/.test(s)) return "positive";
  if (/FAIL|ERROR|BAD|CRITICAL|UNHEALTHY/.test(s)) return "negative";
  if (/WARN|CAUTION|MODERATE/.test(s)) return "warning";
  return "default";
}

function formatValue(v: string | number | boolean): string {
  if (typeof v === "number") return formatNumber(v, Number.isInteger(v) ? 0 : 2);
  if (typeof v === "boolean") return v ? "✓" : "✗";
  return v;
}

/**
 * Generic, crash-proof renderer for `health_checks` / `scenarios` — both are
 * arrays of loosely-shaped objects (`Record<string, unknown>[]`) with no
 * guaranteed fields, so this reads a handful of common field names and falls
 * back to dumping whatever primitive fields the item does have.
 */
export default function InsightList({ title, items }: { title: string; items: AnyRecord[] }) {
  const { t } = useI18n();
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <div className="divide-y divide-border">
        {items.map((item, i) => {
          const titleText = pickString(item, TITLE_KEYS);
          const statusText = pickString(item, STATUS_KEYS);
          const passed = pickBoolean(item, PASSED_KEYS);
          const descriptionText = pickString(item, DESCRIPTION_KEYS);
          const usedKeys = [...TITLE_KEYS, ...STATUS_KEYS, ...DESCRIPTION_KEYS, ...PASSED_KEYS];
          const remaining = remainingEntries(item, usedKeys);
          const showBadge = statusText != null || passed != null;

          return (
            <div key={i} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-text-primary">
                  {titleText ?? `#${i + 1}`}
                </p>
                {showBadge && (
                  <Badge variant={severityVariant(statusText, passed)}>
                    {statusText
                      ? enumLabel(t.analytics.healthStates, statusText)
                      : passed
                        ? t.cli.ok
                        : t.cli.failed}
                  </Badge>
                )}
              </div>
              {descriptionText && (
                <p className="mt-1 text-xs text-text-secondary">{descriptionText}</p>
              )}
              {remaining.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {remaining.map((r) => (
                    <span key={r.label} className="text-2xs text-text-tertiary">
                      {r.label}:{" "}
                      <span className="tabular-nums text-text-secondary">{formatValue(r.value)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
