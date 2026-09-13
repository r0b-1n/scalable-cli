import { Plus } from "lucide-react";
import type { Column } from "../ui/DataTable";
import type { Derivative, DerivativeType } from "../../api/types";
import type { Translations } from "../../i18n";
import { formatDate, formatNumber } from "../../lib/format";
import {
  distanceValue,
  formatDerivativeValue,
  formatGreekOrFactor,
  greekOrFactorSortValue,
  issuerLabel,
} from "./derivativesLib";

/**
 * The fixed result-table shape the spec calls for: ISIN, issuer, leverage,
 * strike, barrier, distance to barrier/strike, premium, omega/delta/factor,
 * implied vol, expiry. Every derivative type shares this column set — fields
 * that do not apply to the selected family simply render "—", the same
 * convention the rest of the app uses for absent values.
 */
export function buildDerivativeColumns(
  t: Translations,
  derivativeType: DerivativeType,
  onBuy: (isin: string) => void
): Column<Derivative>[] {
  const distanceLabel =
    derivativeType === "knockout" ? t.derivatives.distanceToBarrier : t.derivatives.distanceToStrike;

  return [
    {
      key: "isin",
      header: t.trade.isinLabel,
      cell: (d) => <span className="font-mono text-xs">{d.isin}</span>,
      sortValue: (d) => d.isin,
      exportValue: (d) => d.isin,
    },
    {
      key: "issuer",
      header: t.derivatives.issuer,
      cell: (d) => issuerLabel(d.issuer),
      sortValue: (d) => issuerLabel(d.issuer),
      hideNarrow: true,
    },
    {
      key: "leverage",
      header: t.derivatives.leverage,
      align: "right",
      cell: (d) => (d.leverage != null ? `${formatNumber(d.leverage)}×` : "—"),
      sortValue: (d) => d.leverage,
      exportValue: (d) => d.leverage,
    },
    {
      key: "strike",
      header: t.derivatives.strike,
      align: "right",
      cell: (d) => formatDerivativeValue(d.strike),
      sortValue: (d) => d.strike?.value,
      exportValue: (d) => d.strike?.value,
    },
    {
      key: "barrier",
      header: t.derivatives.barrier,
      align: "right",
      cell: (d) => formatDerivativeValue(d.knockout_barrier),
      sortValue: (d) => d.knockout_barrier?.value,
      exportValue: (d) => d.knockout_barrier?.value,
      hideNarrow: true,
    },
    {
      key: "distance",
      header: distanceLabel,
      align: "right",
      cell: (d) => {
        const v = distanceValue(d);
        return v != null ? `${formatNumber(v, 2)}%` : "—";
      },
      sortValue: (d) => distanceValue(d),
      exportValue: (d) => distanceValue(d),
      hideNarrow: true,
    },
    {
      key: "premium",
      header: t.derivatives.premium,
      align: "right",
      cell: (d) => {
        if (d.premium_absolute?.value == null && d.premium_percentage == null) return "—";
        const abs = d.premium_absolute ? formatDerivativeValue(d.premium_absolute) : null;
        const pct = d.premium_percentage != null ? `${formatNumber(d.premium_percentage, 2)}%` : null;
        return [abs, pct].filter(Boolean).join(" · ");
      },
      sortValue: (d) => d.premium_percentage ?? d.premium_absolute?.value,
      exportValue: (d) => d.premium_percentage ?? d.premium_absolute?.value,
    },
    {
      key: "greekOrFactor",
      header: `${t.derivatives.omega} / ${t.derivatives.delta} / ${t.derivatives.factor}`,
      align: "right",
      cell: (d) => formatGreekOrFactor(d),
      sortValue: (d) => greekOrFactorSortValue(d),
      exportValue: (d) => greekOrFactorSortValue(d),
      hideNarrow: true,
    },
    {
      key: "impliedVolatility",
      header: t.derivatives.impliedVolatility,
      align: "right",
      cell: (d) => (d.implied_volatility != null ? `${formatNumber(d.implied_volatility, 2)}%` : "—"),
      sortValue: (d) => d.implied_volatility,
      exportValue: (d) => d.implied_volatility,
      hideNarrow: true,
    },
    {
      key: "expiry",
      header: t.derivatives.expiry,
      cell: (d) => (d.expiry_is_open_end ? t.derivatives.openEnd : d.expiry_date ? formatDate(d.expiry_date.date) : "—"),
      sortValue: (d) => (d.expiry_is_open_end ? Number.MAX_SAFE_INTEGER : d.expiry_date?.epoch_day ?? null),
      exportValue: (d) => (d.expiry_is_open_end ? t.derivatives.openEnd : d.expiry_date?.date ?? ""),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (d) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onBuy(d.isin);
          }}
          aria-label={t.security.buy}
          title={t.security.buy}
          className="inline-flex cursor-pointer items-center justify-center rounded-full p-1.5 text-text-tertiary transition-colors hover:bg-positive/15 hover:text-positive"
        >
          <Plus size={14} />
        </button>
      ),
    },
  ];
}
