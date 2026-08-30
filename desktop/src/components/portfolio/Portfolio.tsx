import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import Spinner from "../ui/Spinner";
import Badge from "../ui/Badge";
import { formatCurrency, formatPercent, formatNumber } from "../../lib/format";
import { ArrowUpRight, ArrowDownRight, PieChart } from "lucide-react";

export default function Portfolio() {
  const navigate = useNavigate();
  const { activePortfolioId } = useAppStore();
  const [holdings, setHoldings] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"holdings" | "allocation" | "groups">("holdings");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [hl, an, gr] = await Promise.allSettled([
          api.getHoldings(activePortfolioId || undefined),
          api.getBrokerAnalytics(activePortfolioId || undefined),
          api.getPortfolioGroups(activePortfolioId || undefined),
        ]);
        if (hl.status === "fulfilled") {
          const data = hl.value as any;
          setHoldings(data.holdings || data || []);
        }
        if (an.status === "fulfilled") setAnalytics(an.value);
        if (gr.status === "fulfilled") {
          const data = gr.value as any;
          setGroups(data.groups || []);
        }
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

  const totalValue = holdings.reduce((sum: number, h: any) => {
    return sum + parseFloat(h.currentValue || "0");
  }, 0);

  const totalReturn = holdings.reduce((sum: number, h: any) => {
    return sum + parseFloat(h.totalReturn || "0");
  }, 0);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">Portfolio</h1>
        <div className="flex items-center gap-1 bg-bg-card rounded-lg p-1 border border-border">
          {(["holdings", "allocation", "groups"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === tab
                  ? "bg-accent-dim text-accent"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <p className="text-sm text-text-secondary mb-1">Total Value</p>
          <p className="text-2xl font-bold text-text-primary">{formatCurrency(totalValue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-text-secondary mb-1">Total Return</p>
          <p className={`text-2xl font-bold ${totalReturn >= 0 ? "text-positive" : "text-negative"}`}>
            {formatCurrency(totalReturn)}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-text-secondary mb-1">Holdings</p>
          <p className="text-2xl font-bold text-text-primary">{holdings.length}</p>
        </Card>
      </div>

      {activeTab === "holdings" && (
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Security
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Price
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Value
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Return
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Day Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h: any, i: number) => {
                  const ret = parseFloat(h.totalReturnPercent || "0");
                  const day = parseFloat(h.dayChangePercent || "0");
                  return (
                    <tr
                      key={h.isin || i}
                      className="border-b border-border/50 hover:bg-bg-card-hover transition-colors cursor-pointer"
                      onClick={() => navigate(`/security/${h.isin}`)}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-bg-primary flex items-center justify-center text-xs font-bold text-text-secondary">
                            {(h.name || h.isin || "?").charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-text-primary">
                              {h.name || h.isin}
                            </p>
                            <p className="text-xs text-text-secondary">{h.isin}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right text-sm text-text-primary">
                        {formatCurrency(parseFloat(h.currentPrice || "0"))}
                      </td>
                      <td className="px-5 py-3.5 text-right text-sm font-medium text-text-primary">
                        {formatCurrency(parseFloat(h.currentValue || "0"))}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={`text-sm font-medium ${ret >= 0 ? "text-positive" : "text-negative"}`}>
                          {formatPercent(ret)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={`text-sm font-medium ${day >= 0 ? "text-positive" : "text-negative"}`}>
                          {formatPercent(day)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === "allocation" && analytics && (
        <Card>
          <CardHeader>
            <CardTitle>Asset Allocation</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {(analytics.allocations || []).map((a: any, i: number) => (
              <div
                key={i}
                className="p-4 bg-bg-primary rounded-xl border border-border"
              >
                <p className="text-sm font-medium text-text-primary">{a.name}</p>
                <p className="text-2xl font-bold text-accent mt-1">
                  {formatNumber(a.percentage)}%
                </p>
                {a.value && (
                  <p className="text-xs text-text-secondary mt-1">{a.value}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === "groups" && (
        <div className="space-y-4">
          {groups.length === 0 ? (
            <Card>
              <p className="text-sm text-text-secondary text-center py-8">
                No portfolio groups found. Create groups to organize your holdings.
              </p>
            </Card>
          ) : (
            groups.map((g: any) => (
              <Card key={g.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-text-primary">{g.name}</h3>
                    {g.description && (
                      <p className="text-xs text-text-secondary mt-1">{g.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-text-primary">
                      {g.totalValue ? formatCurrency(parseFloat(g.totalValue)) : "N/A"}
                    </p>
                    {g.totalReturnPercent && (
                      <p
                        className={`text-xs font-medium ${
                          parseFloat(g.totalReturnPercent) >= 0 ? "text-positive" : "text-negative"
                        }`}
                      >
                        {formatPercent(parseFloat(g.totalReturnPercent))}
                      </p>
                    )}
                  </div>
                </div>
                {g.items && g.items.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border space-y-2">
                    {g.items.slice(0, 3).map((item: any) => (
                      <div key={item.isin} className="flex items-center justify-between text-sm">
                        <span className="text-text-secondary">{item.name || item.isin}</span>
                        <span className="text-text-primary">
                          {item.currentValue ? formatCurrency(parseFloat(item.currentValue)) : ""}
                        </span>
                      </div>
                    ))}
                    {g.items.length > 3 && (
                      <p className="text-xs text-text-secondary">
                        +{g.items.length - 3} more
                      </p>
                    )}
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
