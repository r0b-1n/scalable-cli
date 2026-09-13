import { cn } from "../../lib/utils";
import {
  LayoutDashboard,
  Briefcase,
  ArrowLeftRight,
  Star,
  PiggyBank,
  Bell,
  Moon,
  Settings,
  LogOut,
  PieChart,
  Layers,
  Scale,
  ListOrdered,
  Sparkles,
  Coins,
  Receipt,
  Terminal,
} from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { ScalableMark } from "../brand/Logo";
import { useI18n, type Translations } from "../../i18n";

interface SidebarProps {
  activeRoute: string;
  onNavigate: (path: string) => void;
}

type NavKey = keyof Translations["nav"];

interface NavItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
}

interface NavSection {
  /** Untitled sections render without a heading (the first one). */
  title?: string;
  items: NavItem[];
}

export default function Sidebar({ activeRoute, onNavigate }: SidebarProps) {
  const { setAuthenticated, setUser } = useAppStore();
  const { t } = useI18n();

  const nav = (key: NavKey) => t.nav[key] as string;

  const sections: NavSection[] = [
    {
      items: [{ path: "/", label: nav("dashboard"), icon: LayoutDashboard }],
    },
    {
      title: t.nav.sections.wealth,
      items: [
        { path: "/portfolio", label: nav("portfolio"), icon: Briefcase },
        { path: "/groups", label: t.groups.title, icon: Layers },
        { path: "/analytics", label: t.analytics.title, icon: PieChart },
        { path: "/rebalancing", label: t.rebalancing.title, icon: Scale },
      ],
    },
    {
      title: t.nav.sections.trading,
      items: [
        { path: "/orders", label: t.orders.title, icon: ListOrdered },
        { path: "/derivatives", label: t.derivatives.title, icon: Sparkles },
      ],
    },
    {
      title: t.nav.sections.saving,
      items: [
        { path: "/savings-plans", label: nav("savingsPlans"), icon: PiggyBank },
        { path: "/overnight", label: nav("overnight"), icon: Moon },
      ],
    },
    {
      title: t.nav.sections.markets,
      items: [
        { path: "/watchlist", label: nav("watchlist"), icon: Star },
        { path: "/price-alerts", label: nav("priceAlerts"), icon: Bell },
      ],
    },
    {
      title: t.nav.sections.reports,
      items: [
        { path: "/transactions", label: nav("transactions"), icon: ArrowLeftRight },
        { path: "/reports/income", label: t.reports.income, icon: Coins },
        { path: "/reports/costs", label: t.reports.costs, icon: Receipt },
      ],
    },
  ];

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // A failed revoke still ends the local session; the UI must not trap
      // the user on an authenticated screen.
    }
    setAuthenticated(false);
    setUser(null);
  };

  const isActive = (path: string) =>
    path === "/" ? activeRoute === "/" : activeRoute.startsWith(path);

  const itemClass = (active: boolean) =>
    cn(
      "relative w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
      active
        ? "text-text-primary bg-hover"
        : "text-text-secondary hover:text-text-primary hover:bg-hover"
    );

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-border bg-bg-secondary">
      <div className="px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent">
            <ScalableMark className="h-4 w-4 text-on-accent" />
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold text-text-primary">Scalable</span>
            <span className="text-2xs text-text-tertiary">Desktop</span>
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-0.5">
        {sections.map((section, index) => (
          <div key={section.title ?? `section-${index}`} className="space-y-0.5">
            {section.title && (
              <p className="px-3 pt-0.5 pb-1 text-2xs font-medium tracking-[0.08em] text-text-tertiary uppercase">
                {section.title}
              </p>
            )}
            {section.items.map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => onNavigate(item.path)}
                  aria-current={active ? "page" : undefined}
                  className={itemClass(active)}
                >
                  {active && (
                    <span className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                  )}
                  <item.icon size={17} strokeWidth={1.75} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-border px-3 py-2">
        <button onClick={() => onNavigate("/cli")} className={itemClass(isActive("/cli"))}>
          {isActive("/cli") && (
            <span className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
          )}
          <Terminal size={17} strokeWidth={1.75} />
          {t.cli.title}
        </button>
        <button
          onClick={() => onNavigate("/settings")}
          className={itemClass(activeRoute === "/settings")}
        >
          {activeRoute === "/settings" && (
            <span className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
          )}
          <Settings size={17} strokeWidth={1.75} />
          {nav("settings")}
        </button>
        <button
          onClick={handleLogout}
          className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium text-text-secondary transition-all duration-150 hover:bg-negative-dim hover:text-negative"
        >
          <LogOut size={17} strokeWidth={1.75} />
          {nav("logout")}
        </button>
      </div>
    </aside>
  );
}
