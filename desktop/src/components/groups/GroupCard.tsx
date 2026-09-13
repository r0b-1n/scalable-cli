import { Pencil, Trash2 } from "lucide-react";
import Badge from "../ui/Badge";
import Card, { CardHeader } from "../ui/Card";
import Select from "../ui/Select";
import { formatCurrency, formatPercent } from "../../lib/format";
import { enumLabel, useI18n } from "../../i18n";
import type { Holding, PortfolioGroup } from "../../api/types";

/** Live valuation/since-buy P&L for a group, cross-referenced from `getHoldings`. */
function computeLivePnl(group: PortfolioGroup, holdingsByIsin: Map<string, Holding>) {
  let valuation = 0;
  let costBasis = 0;
  let matched = 0;
  for (const item of group.items) {
    const h = holdingsByIsin.get(item.isin);
    if (!h) continue;
    matched++;
    valuation += h.valuation ?? 0;
    costBasis += (h.fifo_price ?? 0) * (h.quantity ?? 0);
  }
  const abs = valuation - costBasis;
  const pct = costBasis > 0 ? (abs / costBasis) * 100 : 0;
  return { valuation, abs, pct, matched };
}

interface GroupCardProps {
  group: PortfolioGroup;
  otherGroups: PortfolioGroup[];
  holdingsByIsin: Map<string, Holding>;
  onEdit: () => void;
  onDelete: () => void;
  onMoveItem: (isin: string, targetGroupId: string | null) => void;
  movingIsin: string | null;
}

export default function GroupCard({
  group,
  otherGroups,
  holdingsByIsin,
  onEdit,
  onDelete,
  onMoveItem,
  movingIsin,
}: GroupCardProps) {
  const { t } = useI18n();
  const currency = group.performance?.currency || "EUR";
  const apiValuation = parseFloat(group.performance?.valuation || "0");
  const apiSinceBuyPct = parseFloat(group.performance?.since_buy?.performance || "0") * 100;
  const apiSinceBuyAbs = parseFloat(group.performance?.since_buy?.simple_absolute_return || "0");
  const live = computeLivePnl(group, holdingsByIsin);

  const moveOptions = [
    { value: "", label: t.groups.ungrouped },
    ...otherGroups.map((g) => ({ value: g.group_id, label: g.name })),
  ];

  return (
    <Card>
      <CardHeader className="items-start">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{group.name}</h3>
          {group.description && (
            <p className="mt-0.5 text-xs text-text-tertiary">{group.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            aria-label={t.groups.edit}
            title={t.groups.edit}
            className="cursor-pointer rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-hover hover:text-text-primary"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onDelete}
            aria-label={t.groups.delete}
            title={t.groups.delete}
            className="cursor-pointer rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-negative/10 hover:text-negative"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </CardHeader>

      <div className="grid grid-cols-2 gap-4 border-b border-border pb-4 sm:grid-cols-4">
        <div>
          <p className="text-2xs text-text-tertiary">{t.groups.valuation}</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-text-primary">
            {formatCurrency(apiValuation, currency)}
          </p>
          {live.matched > 0 && (
            <p className="mt-0.5 text-2xs tabular-nums text-text-tertiary">
              {t.rebalancing.actual}: {formatCurrency(live.valuation, currency)}
            </p>
          )}
        </div>
        <div>
          <p className="text-2xs text-text-tertiary">{t.groups.sinceBuy}</p>
          <p
            className={`mt-1 text-sm font-semibold tabular-nums ${
              apiSinceBuyAbs >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            {apiSinceBuyAbs >= 0 ? "+" : ""}
            {formatCurrency(apiSinceBuyAbs, currency)}
            <span className="ml-1 text-2xs font-medium">{formatPercent(apiSinceBuyPct)}</span>
          </p>
          {live.matched > 0 && (
            <p
              className={`mt-0.5 text-2xs tabular-nums ${
                live.abs >= 0 ? "text-positive" : "text-negative"
              }`}
            >
              {t.rebalancing.actual}: {live.abs >= 0 ? "+" : ""}
              {formatCurrency(live.abs, currency)} · {formatPercent(live.pct)}
            </p>
          )}
        </div>
        <div>
          <p className="text-2xs text-text-tertiary">{t.groups.pendingOrders}</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-text-primary">
            {group.number_of_pending_orders}
          </p>
        </div>
        <div>
          <p className="text-2xs text-text-tertiary">{t.groups.savingsPlanAmount}</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-text-primary">
            {formatCurrency(parseFloat(group.savings_plans_amount || "0"), currency)}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-text-tertiary">
          {t.groups.items} · {group.items.length}
        </p>
        {group.items.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t.portfolio.noHoldingsDesc}</p>
        ) : (
          <div className="divide-y divide-border">
            {group.items.map((item) => {
              const h = holdingsByIsin.get(item.isin);
              return (
                <div key={item.isin} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge>{enumLabel(t.common.securityTypes, item.security_type)}</Badge>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text-primary">{item.name || item.isin}</p>
                      <p className="text-2xs text-text-tertiary">{item.isin}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {h && (
                      <span className="text-sm tabular-nums text-text-secondary">
                        {formatCurrency(h.valuation ?? 0, h.valuation_currency || currency)}
                      </span>
                    )}
                    <Select
                      aria-label={t.groups.assignTo}
                      title={t.groups.assignTo}
                      value={group.group_id}
                      disabled={movingIsin === item.isin}
                      onChange={(e) => {
                        const target = e.target.value;
                        onMoveItem(item.isin, target === "" ? null : target);
                      }}
                      options={[{ value: group.group_id, label: group.name }, ...moveOptions]}
                      className="h-8 w-40 text-xs"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
