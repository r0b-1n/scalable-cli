import { useEffect, useRef, useState } from "react";
import { Briefcase, Check, ChevronDown, RefreshCw, Search } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useI18n } from "../../i18n";
import { api } from "../../api/client";
import { cn } from "../../lib/utils";
import { shortcut } from "../../lib/platform";
import { useToast } from "../ui/Toast";

export default function Header() {
  const {
    setSearchOpen,
    user,
    activePortfolioId,
    availablePortfolios,
    setActivePortfolioId,
    refresh,
  } = useAppStore();
  const { t } = useI18n();
  const { push } = useToast();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  const firstName =
    user?.result?.personOverview?.personalDetails?.firstName || t.header.fallbackName;

  // Dismiss the portfolio menu on an outside click or Escape.
  useEffect(() => {
    if (!switcherOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!switcherRef.current?.contains(e.target as Node)) setSwitcherOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSwitcherOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [switcherOpen]);

  const selectPortfolio = async (portfolioId: string) => {
    if (portfolioId === activePortfolioId) {
      setSwitcherOpen(false);
      return;
    }
    setSwitching(true);
    try {
      // Persist through the CLI so a terminal session sees the same context.
      await api.selectBrokerContext(portfolioId);
      setActivePortfolioId(portfolioId);
      setSwitcherOpen(false);
      refresh();
    } catch (e) {
      push({
        tone: "error",
        title: t.context.selectFailed,
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSwitching(false);
    }
  };

  const canSwitch = availablePortfolios.length > 1;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-col justify-center">
          <span className="truncate text-sm leading-tight font-medium text-text-primary">
            {firstName}
          </span>
          <span className="text-2xs leading-tight text-text-tertiary">{t.header.context}</span>
        </div>

        <div className="relative" ref={switcherRef}>
          <button
            onClick={() => canSwitch && setSwitcherOpen((v) => !v)}
            disabled={!canSwitch || switching}
            aria-haspopup={canSwitch ? "menu" : undefined}
            aria-expanded={canSwitch ? switcherOpen : undefined}
            className={cn(
              "flex h-8 items-center gap-2 rounded-full border border-border px-3 text-2xs text-text-secondary transition-colors",
              canSwitch
                ? "cursor-pointer hover:border-border-strong hover:text-text-primary"
                : "cursor-default opacity-70"
            )}
            title={activePortfolioId ?? undefined}
          >
            <Briefcase size={12} />
            <span className="max-w-[12rem] truncate font-mono">
              {activePortfolioId ?? "—"}
            </span>
            {canSwitch && <ChevronDown size={12} />}
          </button>

          {switcherOpen && (
            <div
              role="menu"
              className="animate-scale-in absolute top-full left-0 z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-border bg-bg-card shadow-pop"
            >
              <p className="border-b border-border px-3 py-2 text-2xs font-medium tracking-[0.08em] text-text-tertiary uppercase">
                {t.context.title}
              </p>
              {availablePortfolios.map((id) => (
                <button
                  key={id}
                  role="menuitem"
                  onClick={() => selectPortfolio(id)}
                  disabled={switching}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-hover disabled:opacity-60"
                >
                  <span className="truncate font-mono text-xs text-text-primary">{id}</span>
                  {id === activePortfolioId && <Check size={14} className="text-accent" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={refresh}
          title={t.common.retry}
          aria-label={t.common.retry}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-hover hover:text-text-primary"
        >
          <RefreshCw size={15} />
        </button>

        <button
          onClick={() => setSearchOpen(true)}
          className="flex h-9 w-72 cursor-pointer items-center gap-2 rounded-full border border-transparent bg-bg-inset px-3.5 text-sm text-text-tertiary transition-all duration-150 hover:border-border-strong hover:text-text-secondary"
        >
          <Search size={14} />
          <span className="flex-1 text-left">{t.header.searchPlaceholder}</span>
          <kbd className="rounded-md bg-bg-card px-1.5 py-0.5 text-2xs text-text-tertiary">
            {shortcut("K")}
          </kbd>
        </button>
      </div>
    </header>
  );
}
