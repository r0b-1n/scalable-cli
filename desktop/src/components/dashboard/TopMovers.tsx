import { useNavigate } from "react-router-dom";
import { CardHeader, CardTitle } from "../ui/Card";
import { formatPercent } from "../../lib/format";
import { useI18n } from "../../i18n";
import type { Holding } from "../../api/types";
import { TrendingUp, TrendingDown } from "lucide-react";

interface Ranked extends Holding {
  ret: number;
}

function MoverRow({ h, onOpen }: { h: Ranked; onOpen: (isin: string) => void }) {
  const pos = h.ret >= 0;
  return (
    <button
      onClick={() => onOpen(h.isin)}
      className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-text-primary">{h.name || h.isin}</p>
        <p className="text-2xs text-text-tertiary">{h.isin}</p>
      </div>
      <span
        className={`shrink-0 text-sm font-medium tabular-nums ${
          pos ? "text-positive" : "text-negative"
        }`}
      >
        {formatPercent(h.ret)}
      </span>
    </button>
  );
}

/**
 * Best/worst holdings by since-buy return (`quote_mid_price` vs `fifo_price`),
 * split so the two lists never overlap even with very few holdings.
 */
export default function TopMovers({ holdings }: { holdings: Holding[] }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const onOpen = (isin: string) => navigate(`/security/${isin}`);

  const withReturn: Ranked[] = holdings
    .filter((h) => h.fifo_price > 0 && h.quote_mid_price != null)
    .map((h) => ({ ...h, ret: (h.quote_mid_price / h.fifo_price - 1) * 100 }));

  if (withReturn.length === 0) return null;

  const sorted = [...withReturn].sort((a, b) => b.ret - a.ret);
  const n = sorted.length;
  const bestCount = Math.min(3, Math.ceil(n / 2));
  const worstCount = Math.min(3, n - bestCount);
  const best = sorted.slice(0, bestCount);
  const worst = sorted.slice(n - worstCount).reverse();

  return (
    <section>
      <CardHeader>
        <CardTitle>{t.dashboard.holdings}</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-text-tertiary">
            <TrendingUp size={12} className="text-positive" aria-hidden="true" />
            {t.portfolio.colReturn}
          </p>
          <div className="divide-y divide-border">
            {best.map((h) => (
              <MoverRow key={h.isin} h={h} onOpen={onOpen} />
            ))}
          </div>
        </div>
        {worst.length > 0 && (
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-text-tertiary">
              <TrendingDown size={12} className="text-negative" aria-hidden="true" />
              {t.portfolio.colReturn}
            </p>
            <div className="divide-y divide-border">
              {worst.map((h) => (
                <MoverRow key={h.isin} h={h} onOpen={onOpen} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
