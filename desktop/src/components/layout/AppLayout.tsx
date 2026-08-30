import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "../../store/appStore";
import Sidebar from "./Sidebar";
import Header from "./Header";
import SearchModal from "../search/SearchModal";
import TradeModal from "../trading/TradeModal";

export default function AppLayout() {
  const { searchOpen, setSearchOpen, tradeModalOpen } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      <Sidebar activeRoute={location.pathname} onNavigate={navigate} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      {tradeModalOpen && <TradeModal />}
    </div>
  );
}
