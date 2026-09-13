import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import { SkeletonLines } from "../ui/Skeleton";
import EmptyState from "../ui/EmptyState";
import CliCommand from "../ui/CliCommand";
import { chartTheme } from "../../lib/chartTheme";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency } from "../../lib/format";
import { useI18n } from "../../i18n";

const MAX_PAGES = 30;
const PAGE_SIZE = 100;

function monthKeyOf(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Interest-history chart by month: pages `get_overnight_transactions` (typed
 * to `INTEREST`) to exhaustion and buckets the amounts — `sc` itself has no
 * "interest by month" report, so this reconstructs one from the ledger.
 */
export default function InterestHistoryChart({ savingsAccountId }: { savingsAccountId?: string }) {
  const { t } = useI18n();
  const refreshToken = useAppStore((s) => s.refreshToken);
  const [monthly, setMonthly] = useState<{ month: string; interest: number }[]>([]);
  const [currency, setCurrency] = useState("EUR");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = { savingsAccountId, typeFilter: ["INTEREST"], pageSize: PAGE_SIZE };
        const byMonth = new Map<string, number>();
        let cur: string | undefined;
        let cur2 = "EUR";
        for (let page = 0; page < MAX_PAGES; page++) {
          const res = await api.getOvernightTransactions({ ...params, cursor: cur });
          const items = res.result.items ?? [];
          for (const tx of items) {
            const key = monthKeyOf(tx.last_event_datetime);
            byMonth.set(key, (byMonth.get(key) ?? 0) + parseFloat(tx.amount || "0"));
            cur2 = tx.currency || cur2;
          }
          cur = res.result.cursor ?? undefined;
          if (!cur || items.length === 0) break;
        }
        if (cancelled) return;
        setCurrency(cur2);
        setMonthly(
          [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, interest]) => ({ month, interest }))
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t.common.loadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [savingsAccountId, refreshToken, t.common.loadFailed]);

  const theme = chartTheme();
  const cliCommand = renderCliCommand("get_overnight_transactions", {
    savingsAccountId,
    typeFilter: ["INTEREST"],
    pageSize: PAGE_SIZE,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.overnight.lifetimeInterest}</CardTitle>
      </CardHeader>
      {loading ? (
        <SkeletonLines rows={3} />
      ) : error ? (
        <p className="text-sm text-negative">{error}</p>
      ) : monthly.length === 0 ? (
        <EmptyState title={t.overnight.emptyTitle} description={t.overnight.emptyDesc} />
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="month" tick={theme.axisTick} tickLine={false} axisLine={{ stroke: theme.grid }} />
              <YAxis
                tick={theme.axisTick}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v: number) => formatCurrency(v, currency)}
              />
              <Tooltip
                contentStyle={theme.tooltip}
                labelStyle={theme.tooltipLabel}
                cursor={theme.cursor}
                formatter={(value: number) => formatCurrency(value, currency)}
              />
              <Bar dataKey="interest" name={t.overnight.lifetimeInterest} fill={theme.series[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <CliCommand commands={cliCommand} variant="block" className="mt-3" />
    </Card>
  );
}
