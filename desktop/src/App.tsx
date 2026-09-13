import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAppStore } from "./store/appStore";
import { api } from "./api/client";
import { hasStoredLanguage, normalizeLocale, useI18n } from "./i18n";
import { initTheme } from "./lib/theme";
import { ToastProvider } from "./components/ui/Toast";
import AppLayout from "./components/layout/AppLayout";
import AuthScreen from "./components/auth/AuthScreen";
import PortfolioGate from "./components/auth/PortfolioGate";

import Dashboard from "./components/dashboard/Dashboard";
import Portfolio from "./components/portfolio/Portfolio";
import PortfolioGroups from "./components/groups/PortfolioGroups";
import Analytics from "./components/analytics/Analytics";
import Rebalancing from "./components/rebalancing/Rebalancing";
import Orders from "./components/orders/Orders";
import Derivatives from "./components/derivatives/Derivatives";
import SavingsPlans from "./components/savings/SavingsPlans";
import Overnight from "./components/overnight/Overnight";
import Watchlist from "./components/watchlist/Watchlist";
import PriceAlerts from "./components/alerts/PriceAlerts";
import Transactions from "./components/transactions/Transactions";
import IncomeReport from "./components/reports/IncomeReport";
import CostReport from "./components/reports/CostReport";
import SecurityDetail from "./components/security/SecurityDetail";
import Settings from "./components/settings/Settings";
import CliConsole from "./components/cli/CliConsole";

export default function App() {
  const {
    isAuthenticated,
    needsPortfolioSelection,
    user,
    setLoading,
    setAuthenticated,
    setUser,
    setActivePortfolioId,
    setAvailablePortfolios,
    setPortfolioSelection,
    setSearchOpen,
    setCommandPaletteOpen,
  } = useAppStore();
  const { setLang } = useI18n();

  // Stamp the stored theme before first paint so there is no light/dark flash.
  useEffect(() => {
    initTheme();
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      setLoading(true);
      try {
        const whoami = await api.getWhoami();
        setUser(whoami);
        setAuthenticated(true);
      } catch {
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  // Follow the profile locale unless the user picked a language in Settings
  // (that choice is stored and wins). Watching `user` covers both paths:
  // the startup whoami and a fresh AuthScreen login.
  useEffect(() => {
    if (!user || hasStoredLanguage()) return;
    const profileLang = normalizeLocale(user.result?.personOverview?.locale);
    if (profileLang) setLang(profileLang, { persist: false });
  }, [user]);

  // Fresh installs with several portfolios have no broker context yet and
  // every broker command would fail — block on the picker until one is set.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const checkContext = async () => {
      try {
        const list = await api.listBrokerPortfolios().catch(() => null);
        const portfolios = list?.portfolios ?? [];
        if (!cancelled && portfolios.length > 0) setAvailablePortfolios(portfolios);

        const ctx = await api.getBrokerContext();
        const selected = ctx?.context?.portfolio_id;
        if (selected) {
          if (!cancelled) setActivePortfolioId(selected);
          return;
        }
        if (cancelled) return;
        if (portfolios.length === 1) {
          // Only one choice: persist it silently.
          await api.selectBrokerContext(portfolios[0]);
          if (!cancelled) setActivePortfolioId(portfolios[0]);
        } else if (portfolios.length > 1) {
          setPortfolioSelection(true, portfolios);
        }
      } catch {
        // Context state unknown (e.g. offline): views surface their own errors.
      }
    };
    checkContext();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "p" && e.shiftKey) {
        // ⇧⌘P mirrors the convention for "run a command", not "find a thing".
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchOpen, setCommandPaletteOpen]);

  if (!isAuthenticated) {
    return (
      <ToastProvider>
        <AuthScreen />
      </ToastProvider>
    );
  }

  if (needsPortfolioSelection) {
    return (
      <ToastProvider>
        <PortfolioGate />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/groups" element={<PortfolioGroups />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/rebalancing" element={<Rebalancing />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/derivatives" element={<Derivatives />} />
            <Route path="/savings-plans" element={<SavingsPlans />} />
            <Route path="/overnight" element={<Overnight />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/price-alerts" element={<PriceAlerts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/reports/income" element={<IncomeReport />} />
            <Route path="/reports/costs" element={<CostReport />} />
            <Route path="/security/:isin" element={<SecurityDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/cli" element={<CliConsole />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
