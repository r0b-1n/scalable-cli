import { useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../../api/client";
import { renderCliCommand } from "../../lib/cliLog";
import { useI18n } from "../../i18n";
import type { OrderType, TradePreviewData, TradeSide } from "../../api/types";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Spinner from "../ui/Spinner";
import CliCommand from "../ui/CliCommand";
import DisclosureSection from "../ui/DisclosureSection";

interface WhatIfRow {
  id: number;
  amount: string;
  shares: string;
  loading: boolean;
  data: TradePreviewData | null;
  error: string | null;
}

interface CostWhatIfProps {
  side: TradeSide;
  isin: string;
  orderType: OrderType;
  limitPrice: string;
  stopPrice: string;
  venue: string;
}

let nextRowId = 1;

/**
 * Order Cost What-If: re-runs `trade_preview` at sizes the user chooses,
 * purely to compare the ex-ante cost disclosure side by side. Every run is
 * its own independent preview call — none of these ever produces a
 * confirmation the user can act on, so there is nothing here to confirm or
 * submit, by construction.
 */
export default function CostWhatIf({ side, isin, orderType, limitPrice, stopPrice, venue }: CostWhatIfProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<WhatIfRow[]>([]);

  const addRow = () =>
    setRows((prev) => [...prev, { id: nextRowId++, amount: "", shares: "", loading: false, data: null, error: null }]);
  const removeRow = (id: number) => setRows((prev) => prev.filter((r) => r.id !== id));
  const updateRow = (id: number, patch: Partial<WhatIfRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const buildArgs = (row: WhatIfRow) => ({
    side,
    isin: isin.trim(),
    amount: side === "buy" ? row.amount.trim() || undefined : undefined,
    shares: row.shares.trim() || undefined,
    orderType,
    limitPrice: orderType === "limit" ? limitPrice.trim() || undefined : undefined,
    stopPrice: orderType === "stop" ? stopPrice.trim() || undefined : undefined,
    venue: venue.trim() || undefined,
  });

  const runRow = async (row: WhatIfRow) => {
    if (!isin.trim() || (!row.amount.trim() && !row.shares.trim())) return;
    updateRow(row.id, { loading: true, error: null });
    try {
      const data = await api.tradePreview(buildArgs(row));
      updateRow(row.id, { data, loading: false });
    } catch (err) {
      updateRow(row.id, {
        error: err instanceof Error ? err.message : t.trade.previewFailed,
        loading: false,
        data: null,
      });
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-medium uppercase tracking-[0.08em] text-text-tertiary">
          {t.trade.rowEstTotal}
        </span>
        <Button variant="ghost" size="sm" onClick={addRow} disabled={!isin.trim()}>
          <Plus size={13} className="mr-1" />
          {t.common.add}
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="space-y-2 rounded-xl border border-border/70 p-3">
              <div className="flex items-end gap-2">
                {side === "buy" && (
                  <div className="flex-1">
                    <Input
                      label={t.trade.amountLabel}
                      type="number"
                      placeholder={t.trade.amountPlaceholder}
                      value={row.amount}
                      onChange={(e) => updateRow(row.id, { amount: e.target.value, shares: "" })}
                    />
                  </div>
                )}
                <div className="flex-1">
                  <Input
                    label={t.trade.sharesLabel}
                    type="number"
                    placeholder={side === "buy" ? t.trade.sharesPlaceholderBuy : t.trade.sharesPlaceholderSell}
                    value={row.shares}
                    onChange={(e) => updateRow(row.id, { shares: e.target.value, amount: "" })}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => runRow(row)}
                  disabled={row.loading || !isin.trim() || (!row.amount.trim() && !row.shares.trim())}
                >
                  {row.loading ? <Spinner size={14} /> : t.trade.previewOrder}
                </Button>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  aria-label={t.groups.unassign}
                  title={t.groups.unassign}
                  className="cursor-pointer rounded-full p-2 text-text-tertiary transition-colors hover:bg-negative/10 hover:text-negative"
                >
                  <X size={14} />
                </button>
              </div>

              {row.error && <p className="whitespace-pre-line text-xs text-negative">{row.error}</p>}

              {row.data && (
                <div className="space-y-2">
                  {row.data.presentation.section_order
                    .filter((key) => key === "calculation" || key === "ex_ante_costs")
                    .map((key) => {
                      const section = row.data!.presentation.sections[key];
                      return section ? (
                        <DisclosureSection
                          key={key}
                          section={section}
                          displayNullAsLiteral={row.data!.compliance?.presentation?.display_null_as_literal}
                          className="p-3"
                        />
                      ) : null;
                    })}
                  <CliCommand commands={renderCliCommand("trade_preview", buildArgs(row))} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
