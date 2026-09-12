import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAppStore } from "./store/appStore";
import { api } from "./api/client";
import { hasStoredLanguage, normalizeLocale, useI18n } from "./i18n";
import AppLayout from "./components/layout/AppLayout";
import Dashboard from "./components/dashboard/Dashboard";
import Portfolio from "./components/portfolio/Portfolio";
import Transactions from "./components/transactions/Transactions";
import Watchlist from "./components/watchlist/Watchlist";
import SavingsPlans from "./components/savings/SavingsPlans";
import PriceAlerts from "./components/alerts/PriceAlerts";
import Overnight from "./components/overnight/Overnight";
import Settings from "./components/settings/Settings";
import AuthScreen from "./components/auth/AuthScreen";
import PortfolioGate from "./components/auth/PortfolioGate";
import SecurityDetail from "./components/security/SecurityDetail";

export default function App() {
  const {
    isAuthenticated,
    needsPortfolioSelection,
    setLoading,
    setAuthenticated,
    setUser,
    setActivePortfolioId,
    setPortfolioSelection,
  } = useAppStore();
  const { setLang } = useI18n();

  const { setSearchOpen } = useAppStore();

  const { user } = useAppStore();

  useEffect(() => {
    const checkAuth = async () => {
      setLoading(true);
      try {
        const user = await api.getWhoami();
        setUser(user);
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
    const profileLang = normalizeLocale(
      (user as any)?.result?.personOverview?.locale
    );
    if (profileLang) setLang(profileLang, { persist: false });
  }, [user]);

  // Fresh installs with several portfolios have no broker context yet and
  // every broker command would fail — block on the picker until one is set.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const checkContext = async () => {
      try {
        const ctx = await api.getBrokerContext();
        const selected = ctx?.context?.portfolio_id;
        if (selected) {
          if (!cancelled) setActivePortfolioId(selected);
          return;
        }
        const list = await api.listBrokerPortfolios();
        const portfolios = list?.portfolios ?? [];
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
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchOpen]);

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  if (needsPortfolioSelection) {
    return <PortfolioGate />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/savings-plans" element={<SavingsPlans />} />
          <Route path="/price-alerts" element={<PriceAlerts />} />
          <Route path="/overnight" element={<Overnight />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/security/:isin" element={<SecurityDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
