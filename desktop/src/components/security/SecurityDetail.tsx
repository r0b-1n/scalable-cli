import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Bell, Layers, Minus, PiggyBank, Plus, Star } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { enumLabel, useI18n } from "../../i18n";
import { useToast } from "../ui/Toast";
import { renderCliCommand } from "../../lib/cliLog";
import { formatCurrency, formatDateTime, formatPercent } from "../../lib/format";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import Spinner from "../ui/Spinner";
import Stat from "../ui/Stat";
import CliCommand from "../ui/CliCommand";
import { SkeletonLines } from "../ui/Skeleton";
import type { QuoteData } from "../../api/types";
import SecurityPriceChart from "./SecurityPriceChart";
import SecurityPosition from "./SecurityPosition";
import SecurityNewsSection from "./SecurityNewsSection";
import CreatePriceAlertModal from "./CreatePriceAlertModal";
import CreateSavingsPlanModal from "./CreateSavingsPlanModal";

export default function SecurityDetail() {
  const { isin: rawIsin } = useParams<{ isin: string }>();
  const isin = (rawIsin || "").toUpperCase();
  const navigate = useNavigate();
  const { activePortfolioId, refreshToken, openTradeModal } = useAppStore();
  const { t, lang } = useI18n();
  const { push } = useToast();

  const [quote, setQuote] = useState<QuoteData["result"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isWatched, setIsWatched] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);

  const [alertOpen, setAlertOpen] = useState(false);
  const [savingsOpen, setSavingsOpen] = useState(false);

  const load = useCallback(async () => {
    if (!isin) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getQuote(isin, { portfolioId: activePortfolioId || undefined });
      setQuote(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [isin, activePortfolioId, t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  useEffect(() => {
    if (!isin) return;
    api
      .getWatchlist({ portfolioId: activePortfolioId || undefined })
      .then((data) => setIsWatched(data.result.items.some((i) => i.isin === isin)))
      .catch(() => setIsWatched(false));
  }, [isin, activePortfolioId, refreshToken]);

  const toggleWatch = async () => {
    if (watchBusy) return;
    setWatchBusy(true);
    try {
      if (isWatched) {
        await api.removeFromWatchlist(isin, activePortfolioId || undefined);
        setIsWatched(false);
        push({ tone: "success", title: t.watchlist.removed });
      } else {
        await api.addToWatchlist(isin, activePortfolioId || undefined);
        setIsWatched(true);
        push({ tone: "success", title: t.watchlist.added });
      }
    } catch (err) {
      push({ tone: "error", title: t.common.actionFailed, description: err instanceof Error ? err.message : undefined });
    } finally {
      setWatchBusy(false);
    }
  };

  const locale = lang === "de" ? "de_DE" : "en_DE";

  const cliCommands = useMemo(
    () => [
      renderCliCommand("get_quote", { isin, portfolioId: activePortfolioId || undefined }),
      renderCliCommand("get_holdings", { portfolioId: activePortfolioId || undefined }),
      renderCliCommand("get_transactions", { portfolioId: activePortfolioId || undefined, isin }),
      renderCliCommand("get_security_news", { isin, locale }),
    ],
    [isin, activePortfolioId, locale]
  );

  if (!isin) return null;

  if (loading) {
    return (
      <div className="space-y-8">
        <SkeletonLines rows={4} />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-text-secondary">{error || t.security.notFound}</p>
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} className="mr-2" />
          {t.security.goBack}
        </Button>
      </div>
    );
  }

  const currency = quote.quote_currency || "EUR";
  const spread =
    quote.quote_ask_price != null && quote.quote_bid_price != null
      ? quote.quote_ask_price - quote.quote_bid_price
      : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="mb-4 flex cursor-pointer items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft size={15} />
            {t.security.back}
          </button>
          <div className="flex items-center gap-3">
            <Stat
              size="hero"
              label={`${quote.name || quote.isin} · ${quote.isin}`}
              value={formatCurrency(quote.quote_mid_price ?? 0, currency)}
            />
            <Badge>{enumLabel(t.common.securityTypes, quote.security_type)}</Badge>
            {quote.quote_is_outdated && <Badge variant="warning">{t.security.quoteOutdated}</Badge>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(quote.quote_performances ?? []).map((p) => (
              <span
                key={p.timeframe}
                className={`rounded-full px-2.5 py-1 text-2xs font-medium tabular-nums ${
                  p.performance >= 0 ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
                }`}
                title={p.timeframe}
              >
                {formatPercent(p.performance * 100)} · {formatCurrency(p.simple_absolute_return, currency)}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={toggleWatch} disabled={watchBusy}>
            {watchBusy ? <Spinner size={14} className="mr-1.5" /> : <Star size={14} className="mr-1.5" fill={isWatched ? "currentColor" : "none"} />}
            {t.security.watch}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAlertOpen(true)}>
            <Bell size={14} className="mr-1.5" />
            {t.alerts.newAlert}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSavingsOpen(true)}>
            <PiggyBank size={14} className="mr-1.5" />
            {t.savings.newPlan}
          </Button>
          <Button size="sm" onClick={() => openTradeModal("buy", isin)}>
            <Plus size={14} className="mr-1.5" />
            {t.security.buy}
          </Button>
          <Button variant="danger" size="sm" onClick={() => openTradeModal("sell", isin)}>
            <Minus size={14} className="mr-1.5" />
            {t.security.sell}
          </Button>
        </div>
      </div>

      {/* Quote strip */}
      <section className="grid grid-cols-2 gap-y-4 divide-x divide-border border-b border-border pb-8 sm:grid-cols-4">
        <Stat label={t.security.bid} value={quote.quote_bid_price != null ? formatCurrency(quote.quote_bid_price, currency) : "—"} />
        <div className="pl-6">
          <Stat label={t.security.ask} value={quote.quote_ask_price != null ? formatCurrency(quote.quote_ask_price, currency) : "—"} />
        </div>
        <div className="pl-6">
          <Stat label={t.rebalancing.drift} value={spread != null ? formatCurrency(spread, currency) : "—"} />
        </div>
        <div className="pl-6">
          <Stat
            label={t.security.lastUpdated}
            value={<span className="text-sm font-medium">{quote.quote_timestamp_utc ? formatDateTime(quote.quote_timestamp_utc) : "—"}</span>}
          />
        </div>
      </section>

      <SecurityPriceChart isin={isin} currency={currency} />

      <button
        onClick={() => navigate(`/derivatives?underlying=${isin}`)}
        className="flex w-full cursor-pointer items-center justify-between rounded-2xl border border-border bg-bg-card p-4 text-left transition-colors hover:bg-bg-card-hover"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Layers size={16} className="text-text-tertiary" />
          {t.derivatives.title}
        </span>
        <ArrowRight size={16} className="text-text-tertiary" />
      </button>

      <SecurityPosition isin={isin} portfolioId={activePortfolioId || undefined} />

      <SecurityNewsSection isin={isin} locale={locale} />

      <CliCommand commands={cliCommands} variant="block" />

      <CreatePriceAlertModal
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        isin={isin}
        name={quote.name}
        portfolioId={activePortfolioId || undefined}
      />
      <CreateSavingsPlanModal
        open={savingsOpen}
        onClose={() => setSavingsOpen(false)}
        isin={isin}
        name={quote.name}
        portfolioId={activePortfolioId || undefined}
      />
    </div>
  );
}
