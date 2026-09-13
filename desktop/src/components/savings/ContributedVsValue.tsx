import { useCallback, useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import Card, { CardHeader, CardTitle } from "../ui/Card";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import DataTable, { type Column } from "../ui/DataTable";
import EmptyState from "../ui/EmptyState";
import Spinner from "../ui/Spinner";
import CliCommand from "../ui/CliCommand";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency, formatNumber, formatPercent } from "../../lib/format";
import { useI18n } from "../../i18n";
import type { Holding } from "../../api/types";
import { fetchAllTransactions } from "./savingsData";

interface Row {
  isin: string;
  name: string;
  contributed: number;
  currentValue: number;
  currency: string;
  executions: number;
}

/**
 * Contributed vs current value (composite): there is no single `sc` command
 * for "how much have I put in vs what it's worth" — this sums every
 * `SAVINGS_PLAN` transaction per ISIN from `get_transactions` (paginated to
 * exhaustion) and compares the total against the live valuation from
 * `get_holdings`.
 */
export default function ContributedVsValue({ portfolioId }: { portfolioId?: string }) {
  const { t } = useI18n();
  const refreshToken = useAppStore((s) => s.refreshToken);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadedCount(0);
    try {
      const [txItems, holdingsRes] = await Promise.all([
        fetchAllTransactions({ portfolioId, typeFilter: ["SAVINGS_PLAN"] }, 100, setLoadedCount),
        api.getHoldings({ portfolioId }),
      ]);
      const holdingsByIsin = new Map<string, Holding>(
        (holdingsRes.result.items ?? []).map((h) => [h.isin, h])
      );

      const byIsin = new Map<string, Row>();
      for (const tx of txItems) {
        if (!tx.isin) continue;
        const row =
          byIsin.get(tx.isin) ??
          ({
            isin: tx.isin,
            name: holdingsByIsin.get(tx.isin)?.name || tx.isin,
            contributed: 0,
            currentValue: holdingsByIsin.get(tx.isin)?.valuation ?? 0,
            currency: tx.currency || holdingsByIsin.get(tx.isin)?.valuation_currency || "EUR",
            executions: 0,
          } satisfies Row);
        row.contributed += Math.abs(tx.amount ?? 0);
        row.executions += 1;
        byIsin.set(tx.isin, row);
      }
      setRows([...byIsin.values()].sort((a, b) => b.contributed - a.contributed));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [portfolioId, t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const columns: Column<Row>[] = [
    {
      key: "security",
      header: t.portfolio.colSecurity,
      cell: (r) => (
        <div>
          <p className="text-sm font-medium text-text-primary">{r.name}</p>
          <p className="text-2xs text-text-tertiary">{r.isin}</p>
        </div>
      ),
      sortValue: (r) => r.name,
      exportValue: (r) => `${r.name} (${r.isin})`,
    },
    {
      key: "executions",
      header: t.transactions.colQuantity,
      align: "right",
      cell: (r) => formatNumber(r.executions, 0),
      sortValue: (r) => r.executions,
    },
    {
      key: "contributed",
      header: t.reports.total,
      align: "right",
      cell: (r) => formatCurrency(r.contributed, r.currency),
      sortValue: (r) => r.contributed,
      exportValue: (r) => r.contributed,
    },
    {
      key: "value",
      header: t.portfolio.colValue,
      align: "right",
      cell: (r) => <span className="font-medium">{formatCurrency(r.currentValue, r.currency)}</span>,
      sortValue: (r) => r.currentValue,
      exportValue: (r) => r.currentValue,
    },
    {
      key: "gain",
      header: t.portfolio.colReturn,
      align: "right",
      cell: (r) => {
        const gain = r.currentValue - r.contributed;
        const pct = r.contributed > 0 ? (gain / r.contributed) * 100 : 0;
        return (
          <span className={gain >= 0 ? "text-positive" : "text-negative"}>
            {gain >= 0 ? "+" : ""}
            {formatCurrency(gain, r.currency)}
            <span className="ml-1.5 text-2xs">{formatPercent(pct)}</span>
          </span>
        );
      },
      sortValue: (r) => r.currentValue - r.contributed,
    },
  ];

  const cliCommands = [
    renderCliCommand("get_transactions", { portfolioId, typeFilter: ["SAVINGS_PLAN"] }),
    renderCliCommand("get_holdings", { portfolioId }),
  ];

  return (
    <Card className="space-y-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Coins size={15} className="text-text-tertiary" />
          <CardTitle>{t.savings.contributedTitle}</CardTitle>
        </div>
        <Badge variant="accent">{t.common.derived}</Badge>
      </CardHeader>

      {error && rows.length === 0 && !loading ? (
        <div className="space-y-3 py-10 text-center">
          <p className="text-sm text-text-secondary">{error}</p>
          <Button variant="secondary" size="sm" onClick={load}>
            {t.common.retry}
          </Button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-3 py-10 text-sm text-text-secondary">
          <Spinner size={18} />
          <span className="tabular-nums">
            {t.reports.loadingAll} {loadedCount > 0 && `· ${formatNumber(loadedCount, 0)}`}
          </span>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.isin}
          exportName="savings-plans-contributed-vs-value"
          initialSort={{ key: "contributed", direction: "desc" }}
          empty={<EmptyState icon={<Coins size={20} />} title={t.savings.emptyTitle} description={t.savings.emptyDesc} />}
        />
      )}

      <CliCommand commands={cliCommands} variant="block" />
      <p className="text-xs text-text-tertiary">{t.reports.derivedHint}</p>
    </Card>
  );
}
