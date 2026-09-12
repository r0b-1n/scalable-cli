import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import { Search } from "lucide-react";

export default function Header() {
  const { setSearchOpen, user } = useAppStore();
  const { t } = useI18n();

  const firstName =
    user?.result?.personOverview?.personalDetails?.firstName || t.header.fallbackName;

  return (
    <header className="h-14 flex items-center justify-between px-8 border-b border-border shrink-0">
      <div className="flex flex-col justify-center">
        <span className="text-sm font-medium text-text-primary leading-tight">{firstName}</span>
        <span className="text-2xs text-text-tertiary leading-tight">{t.header.context}</span>
      </div>

      <button
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2 w-72 h-9 px-3.5 rounded-full bg-bg-inset border border-transparent text-text-tertiary text-sm hover:border-border-strong hover:text-text-secondary transition-all duration-150 cursor-pointer"
      >
        <Search size={14} />
        <span className="flex-1 text-left">{t.header.searchPlaceholder}</span>
        <kbd className="px-1.5 py-0.5 bg-bg-card rounded-md text-2xs text-text-tertiary">
          Ctrl+K
        </kbd>
      </button>
    </header>
  );
}
