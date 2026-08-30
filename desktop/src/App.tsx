import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAppStore } from "./store/appStore";
import { api } from "./api/client";
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
import SecurityDetail from "./components/security/SecurityDetail";

export default function App() {
  const { isAuthenticated, setLoading, setAuthenticated, setUser } = useAppStore();

  const { setSearchOpen } = useAppStore();

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
