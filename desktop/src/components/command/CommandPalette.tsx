import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Bell,
  Briefcase,
  Coins,
  CornerDownLeft,
  LayoutDashboard,
  Layers,
  ListOrdered,
  Moon,
  PieChart,
  PiggyBank,
  Receipt,
  Scale,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  Terminal,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  run: () => void;
}

/**
 * ⇧⌘P / Ctrl+Shift+P — jump to a screen or start an action.
 *
 * Distinct from ⌘K, which searches securities. This one navigates the app.
 */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { openTradeModal, setSearchOpen, refresh } = useAppStore();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands: Command[] = useMemo(() => {
    const go = (path: string) => () => {
      navigate(path);
      onClose();
    };
    return [
      { id: "dashboard", label: t.nav.dashboard, icon: LayoutDashboard, run: go("/") },
      { id: "portfolio", label: t.nav.portfolio, icon: Briefcase, run: go("/portfolio") },
      { id: "groups", label: t.groups.title, icon: Layers, run: go("/groups") },
      { id: "analytics", label: t.analytics.title, icon: PieChart, run: go("/analytics") },
      { id: "rebalancing", label: t.rebalancing.title, icon: Scale, run: go("/rebalancing") },
      { id: "orders", label: t.orders.title, icon: ListOrdered, run: go("/orders") },
      { id: "derivatives", label: t.derivatives.title, icon: Sparkles, run: go("/derivatives") },
      { id: "savings", label: t.nav.savingsPlans, icon: PiggyBank, run: go("/savings-plans") },
      { id: "overnight", label: t.nav.overnight, icon: Moon, run: go("/overnight") },
      { id: "watchlist", label: t.nav.watchlist, icon: Star, run: go("/watchlist") },
      { id: "alerts", label: t.nav.priceAlerts, icon: Bell, run: go("/price-alerts") },
      {
        id: "transactions",
        label: t.nav.transactions,
        icon: ArrowLeftRight,
        run: go("/transactions"),
      },
      { id: "income", label: t.reports.income, icon: Coins, run: go("/reports/income") },
      { id: "costs", label: t.reports.costs, icon: Receipt, run: go("/reports/costs") },
      { id: "cli", label: t.cli.title, icon: Terminal, run: go("/cli") },
      { id: "settings", label: t.nav.settings, icon: SettingsIcon, run: go("/settings") },
      {
        id: "buy",
        label: t.trade.buyOrder,
        hint: "sc broker trade buy",
        icon: TrendingUp,
        run: () => {
          openTradeModal("buy");
          onClose();
        },
      },
      {
        id: "sell",
        label: t.trade.sellOrder,
        hint: "sc broker trade sell",
        icon: TrendingDown,
        run: () => {
          openTradeModal("sell");
          onClose();
        },
      },
      {
        id: "search",
        label: t.header.searchPlaceholder,
        hint: "sc broker search",
        icon: Search,
        run: () => {
          setSearchOpen(true);
          onClose();
        },
      },
      {
        id: "refresh",
        label: t.common.retry,
        icon: CornerDownLeft,
        run: () => {
          refresh();
          onClose();
        },
      },
    ];
  }, [t, navigate, onClose, openTradeModal, setSearchOpen, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q)
    );
  }, [commands, query]);

  // A shrinking result list must never leave the cursor past the end.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + Math.max(1, filtered.length)) % Math.max(1, filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[cursor]?.run();
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.cli.commands}
        className="animate-scale-in w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-bg-card shadow-modal"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search size={16} className="shrink-0 text-text-tertiary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.cli.commands}
            className="h-12 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
          />
          <kbd className="rounded-md bg-bg-inset px-1.5 py-0.5 text-2xs text-text-tertiary">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-text-tertiary">
              {t.search.noResults}
            </p>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                data-index={index}
                role="option"
                aria-selected={index === cursor}
                onMouseEnter={() => setCursor(index)}
                onClick={command.run}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  index === cursor ? "bg-hover text-text-primary" : "text-text-secondary"
                )}
              >
                <command.icon size={15} className="shrink-0" />
                <span className="flex-1 truncate">{command.label}</span>
                {command.hint && (
                  <code className="truncate font-mono text-2xs text-text-tertiary">
                    {command.hint}
                  </code>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
