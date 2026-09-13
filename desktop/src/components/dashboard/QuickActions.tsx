import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import type { LucideIcon } from "lucide-react";
import { Plus, Search, Wallet, TrendingUp, Moon, BarChart3 } from "lucide-react";

/** Buy, search, and links into the main screens — the fastest paths off the dashboard. */
export default function QuickActions() {
  const navigate = useNavigate();
  const openTradeModal = useAppStore((s) => s.openTradeModal);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const { t } = useI18n();

  // header.searchPlaceholder is a text-input placeholder ("Search securities…");
  // stripped of its trailing ellipsis it doubles as this action's label.
  const searchLabel = t.header.searchPlaceholder.replace(/…+$/, "");

  const actions: { label: string; icon: LucideIcon; onClick: () => void }[] = [
    { label: t.security.buy, icon: Plus, onClick: () => openTradeModal("buy") },
    { label: searchLabel, icon: Search, onClick: () => setSearchOpen(true) },
    { label: t.watchlist.title, icon: Wallet, onClick: () => navigate("/watchlist") },
    { label: t.savings.title, icon: TrendingUp, onClick: () => navigate("/savings-plans") },
    { label: t.overnight.title, icon: Moon, onClick: () => navigate("/overnight") },
    { label: t.analytics.title, icon: BarChart3, onClick: () => navigate("/analytics") },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-border bg-bg-card p-4 transition-all hover:border-border-strong hover:bg-bg-card-hover"
        >
          <a.icon size={18} strokeWidth={1.75} className="text-text-secondary" />
          <span className="text-center text-xs font-medium text-text-primary">{a.label}</span>
        </button>
      ))}
    </section>
  );
}
