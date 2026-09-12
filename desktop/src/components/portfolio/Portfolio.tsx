import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card from "../ui/Card";
import Spinner from "../ui/Spinner";
import Stat from "../ui/Stat";
import SegmentedControl from "../ui/SegmentedControl";
import EmptyState from "../ui/EmptyState";
import { Table, THead, TH, TR, TD } from "../ui/Table";
import { formatCurrency, formatPercent, formatNumber } from "../../lib/format";
import { useI18n } from "../../i18n";
import { Briefcase } from "lucide-react";

type PortfolioTab = "holdings" | "allocation" | "groups";

export default function Portfolio() {
  const navigate = useNavigate();
  const { activePortfolioId } = useAppStore();
  const { t } = useI18n();
  const [holdings, setHoldings] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PortfolioTab>("holdings");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [hl, an, gr] = await Promise.allSettled([
          api.getHoldings(activePortfolioId || undefined),
          api.getBrokerAnalytics(activePortfolioId || undefined),
          api.getPortfolioGroups(activePortfolioId || undefined),
        ]);
        // sc --json wraps each payload in {resolution, result: {...}}.
        if (hl.status === "fulfilled") setHoldings((hl.value as any)?.result?.items ?? []);
        if (an.status === "fulfilled") setAnalytics((an.value as any)?.result ?? null);
        if (gr.status === "fulfilled") setGroups((gr.value as any)?.result?.items ?? []);
      } catch {
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [activePortfolioId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={32} />
      </div>
    );
  }

  const totalValue = holdings.reduce((sum: number, h: any) => sum + (h.valuation ?? 0), 0);

  const totalReturn = holdings.reduce((sum: number, h: any) => {
    if (h.quote_mid_price == null || h.fifo_price == null || !h.quantity) return sum;
    return sum + (h.quote_mid_price - h.fifo_price) * h.quantity;
  }, 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t.portfolio.title}</h1>
        <SegmentedControl<PortfolioTab>
          options={[
            { value: "holdings", label: t.portfolio.tabHoldings },
            { value: "allocation", label: t.portfolio.tabAllocation },
            { value: "groups", label: t.portfolio.tabGroups },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* Summary */}
      <section className="grid grid-cols-3 divide-x divide-border pb-8 border-b border-border">
        <Stat size="lg" label={t.portfolio.totalValue} value={formatCurrency(totalValue)} />
        <div className="pl-8">
          <Stat
            size="lg"
            label={t.portfolio.totalReturn}
            value={
              <span className={totalReturn >= 0 ? "text-positive" : "text-negative"}>
                {totalReturn >= 0 ? "+" : ""}
                {formatCurrency(totalReturn)}
              </span>
            }
          />
        </div>
        <div className="pl-8">
          <Stat size="lg" label={t.portfolio.holdingsCount} value={holdings.length} />
        </div>
      </section>

      {activeTab === "holdings" &&
        (holdings.length === 0 ? (
          <EmptyState
            icon={<Briefcase size={20} />}
            title={t.portfolio.noHoldingsTitle}
            description={t.portfolio.noHoldingsDesc}
          />
        ) : (
          <Table>
            <THead>
              <TH>{t.portfolio.colSecurity}</TH>
              <TH align="right">{t.portfolio.colPrice}</TH>
              <TH align="right">{t.portfolio.colValue}</TH>
              <TH align="right">{t.portfolio.colReturn}</TH>
              <TH align="right">{t.portfolio.colQuantity}</TH>
            </THead>
            <tbody>
              {holdings.map((h: any, i: number) => {
                const ret =
                  h.fifo_price && h.quote_mid_price != null
                    ? (h.quote_mid_price / h.fifo_price - 1) * 100
                    : 0;
                return (
                  <TR key={h.isin || i} onClick={() => navigate(`/security/${h.isin}`)}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-bg-card flex items-center justify-center text-xs font-semibold text-text-tertiary shrink-0">
                          {(h.name || h.isin || "?").charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {h.name || h.isin}
                          </p>
                          <p className="text-2xs text-text-tertiary">{h.isin}</p>
                        </div>
                      </div>
                    </TD>
                    <TD numeric>{formatCurrency(h.quote_mid_price ?? 0, h.quote_currency || "EUR")}</TD>
                    <TD numeric className="font-medium">
                      {formatCurrency(h.valuation ?? 0, h.valuation_currency || "EUR")}
                    </TD>
                    <TD numeric>
                      <span
                        className={`font-medium ${ret >= 0 ? "text-positive" : "text-negative"}`}
                      >
                        {formatPercent(ret)}
                      </span>
                    </TD>
                    <TD numeric className="text-text-secondary">
                      {formatNumber(h.quantity ?? 0)}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        ))}

      {activeTab === "allocation" &&
        ((analytics?.allocations ?? []).length === 0 ? (
          <EmptyState
            icon={<Briefcase size={20} />}
            title={t.portfolio.noAllocationTitle}
            description={t.portfolio.noAllocationDesc}
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {(analytics.allocations || []).map((a: any, i: number) => (
              <Card key={i}>
                <p className="text-sm font-medium text-text-primary">{a.name}</p>
                <p className="text-2xl font-semibold tabular-nums text-text-primary mt-1">
                  {formatNumber(a.percentage)}%
                </p>
                {a.value && <p className="text-xs text-text-tertiary mt-1">{a.value}</p>}
              </Card>
            ))}
          </div>
        ))}

      {activeTab === "groups" &&
        (groups.length === 0 ? (
          <EmptyState
            icon={<Briefcase size={20} />}
            title={t.portfolio.noGroupsTitle}
            description={t.portfolio.noGroupsDesc}
          />
        ) : (
          <div className="divide-y divide-border">
            {groups.map((g: any) => (
              <div key={g.id} className="py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-text-primary">{g.name}</h3>
                    {g.description && (
                      <p className="text-2xs text-text-tertiary mt-0.5">{g.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-text-primary tabular-nums">
                      {g.totalValue ? formatCurrency(parseFloat(g.totalValue)) : "—"}
                    </p>
                    {g.totalReturnPercent && (
                      <p
                        className={`text-2xs font-medium tabular-nums ${
                          parseFloat(g.totalReturnPercent) >= 0
                            ? "text-positive"
                            : "text-negative"
                        }`}
                      >
                        {formatPercent(parseFloat(g.totalReturnPercent))}
                      </p>
                    )}
                  </div>
                </div>
                {g.items && g.items.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {g.items.slice(0, 3).map((item: any) => (
                      <div key={item.isin} className="flex items-center justify-between text-sm">
                        <span className="text-text-secondary">{item.name || item.isin}</span>
                        <span className="text-text-primary tabular-nums">
                          {item.currentValue ? formatCurrency(parseFloat(item.currentValue)) : ""}
                        </span>
                      </div>
                    ))}
                    {g.items.length > 3 && (
                      <p className="text-2xs text-text-tertiary">{t.portfolio.moreItems(g.items.length - 3)}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
