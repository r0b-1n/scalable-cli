import { useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import Spinner from "../ui/Spinner";
import { Briefcase, AlertCircle, ChevronRight } from "lucide-react";

/**
 * Blocks the app after login until a broker portfolio context exists.
 * Shown only when the account has several portfolios and none is selected —
 * without it, every broker command fails with `broker_context_missing`.
 */
export default function PortfolioGate() {
  const { availablePortfolios, setPortfolioSelection, setActivePortfolioId } = useAppStore();
  const { t } = useI18n();
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (portfolioId: string) => {
    if (selecting) return;
    setSelecting(portfolioId);
    setError(null);
    try {
      await api.selectBrokerContext(portfolioId);
      setActivePortfolioId(portfolioId);
      setPortfolioSelection(false, availablePortfolios);
    } catch (err: any) {
      setError(err?.message || t.context.selectFailed);
      setSelecting(null);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-bg-primary">
      <div className="w-full max-w-sm px-6 animate-slide-up">
        <div className="text-center mb-10">
          <div className="w-14 h-14 mx-auto mb-6 rounded-2xl bg-accent flex items-center justify-center">
            <Briefcase size={24} className="text-bg-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary mb-2">
            {t.context.title}
          </h1>
          <p className="text-sm text-text-secondary">{t.context.body}</p>
        </div>

        <div className="bg-bg-card border border-border rounded-2xl shadow-modal p-3 space-y-1.5">
          {availablePortfolios.map((id) => (
            <button
              key={id}
              onClick={() => choose(id)}
              disabled={selecting !== null}
              className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-left hover:bg-white/[0.04] transition-colors cursor-pointer disabled:opacity-60"
            >
              <span className="text-sm font-medium text-text-primary font-mono">{id}</span>
              {selecting === id ? (
                <Spinner size={16} />
              ) : (
                <ChevronRight size={16} className="text-text-tertiary" />
              )}
            </button>
          ))}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-negative/10 border border-negative/20 rounded-lg">
              <AlertCircle size={16} className="text-negative mt-0.5 shrink-0" />
              <p className="text-xs text-negative">{error}</p>
            </div>
          )}
        </div>

        <p className="text-2xs text-text-tertiary text-center leading-relaxed mt-6">
          {t.context.hint}
        </p>
      </div>
    </div>
  );
}
