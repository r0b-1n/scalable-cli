import { useAppStore } from "../../store/appStore";
import { Search, TrendingUp, TrendingDown } from "lucide-react";

export default function Header() {
  const { setSearchOpen, user } = useAppStore();

  const firstName = user?.personOverview?.firstName || "Trader";

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-bg-secondary/50 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-sm text-text-secondary">
          Welcome back, <span className="text-text-primary font-medium">{firstName}</span>
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-bg-card border border-border rounded-lg text-text-secondary text-sm hover:border-accent/30 hover:text-text-primary transition-all duration-150"
        >
          <Search size={14} />
          <span>Search securities...</span>
          <kbd className="ml-4 px-1.5 py-0.5 bg-bg-primary rounded text-[10px] border border-border">
            Ctrl+K
          </kbd>
        </button>
      </div>
    </header>
  );
}
