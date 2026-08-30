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

interface SidebarProps {
  activeRoute: string;
  onNavigate: (path: string) => void;
}

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/portfolio", label: "Portfolio", icon: Briefcase },
  { path: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { path: "/watchlist", label: "Watchlist", icon: Star },
  { path: "/savings-plans", label: "Savings Plans", icon: PiggyBank },
  { path: "/price-alerts", label: "Price Alerts", icon: Bell },
  { path: "/overnight", label: "Overnight", icon: Moon },
];

export default function Sidebar({ activeRoute, onNavigate }: SidebarProps) {
  const { setAuthenticated, setUser } = useAppStore();

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
    }
    setAuthenticated(false);
    setUser(null);
  };

  return (
    <aside className="w-56 flex flex-col bg-bg-secondary border-r border-border h-screen">
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <span className="text-bg-primary font-bold text-sm">S</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-text-primary">Scalable</div>
            <div className="text-[10px] text-text-secondary uppercase tracking-widest">Desktop</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
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
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-accent-dim text-accent"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-card"
              )}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-border space-y-0.5">
        <button
          onClick={() => onNavigate("/settings")}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
            activeRoute === "/settings"
              ? "bg-accent-dim text-accent"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-card"
          )}
        >
          <Settings size={18} />
          Settings
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:text-negative hover:bg-negative/10 transition-all duration-150"
        >
          <LogOut size={18} />
          Logout
        </button>
      </div>
    </aside>
  );
}
