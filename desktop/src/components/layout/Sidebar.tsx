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
} from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useI18n, type Translations } from "../../i18n";

interface SidebarProps {
  activeRoute: string;
  onNavigate: (path: string) => void;
}

const navItems: { path: string; key: keyof Translations["nav"]; icon: typeof LayoutDashboard }[] = [
  { path: "/", key: "dashboard", icon: LayoutDashboard },
  { path: "/portfolio", key: "portfolio", icon: Briefcase },
  { path: "/transactions", key: "transactions", icon: ArrowLeftRight },
  { path: "/watchlist", key: "watchlist", icon: Star },
  { path: "/savings-plans", key: "savingsPlans", icon: PiggyBank },
  { path: "/price-alerts", key: "priceAlerts", icon: Bell },
  { path: "/overnight", key: "overnight", icon: Moon },
];

export default function Sidebar({ activeRoute, onNavigate }: SidebarProps) {
  const { setAuthenticated, setUser } = useAppStore();
  const { t } = useI18n();

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
    }
    setAuthenticated(false);
    setUser(null);
  };

  return (
    <aside className="w-60 flex flex-col bg-bg-secondary border-r border-border h-screen">
      <div className="px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center">
            <span className="text-bg-primary font-bold text-sm">S</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold text-text-primary">Scalable</span>
            <span className="text-2xs text-text-tertiary">Desktop</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            item.path === "/"
              ? activeRoute === "/"
              : activeRoute.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => onNavigate(item.path)}
              className={cn(
                "relative w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
                isActive
                  ? "text-text-primary bg-white/[0.04]"
                  : "text-text-secondary hover:text-text-primary hover:bg-white/[0.02]"
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-accent" />
              )}
              <item.icon size={17} strokeWidth={1.75} />
              {t.nav[item.key]}
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-border space-y-0.5">
        <button
          onClick={() => onNavigate("/settings")}
          className={cn(
            "relative w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
            activeRoute === "/settings"
              ? "text-text-primary bg-white/[0.04]"
              : "text-text-secondary hover:text-text-primary hover:bg-white/[0.02]"
          )}
        >
          {activeRoute === "/settings" && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-accent" />
          )}
          <Settings size={17} strokeWidth={1.75} />
          {t.nav.settings}
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-negative hover:bg-negative/10 transition-all duration-150 cursor-pointer"
        >
          <LogOut size={17} strokeWidth={1.75} />
          {t.nav.logout}
        </button>
      </div>
    </aside>
  );
}
