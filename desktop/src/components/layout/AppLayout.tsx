import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "../../store/appStore";
import Sidebar from "./Sidebar";
import Header from "./Header";
import SearchModal from "../search/SearchModal";
import TradeModal from "../trading/TradeModal";
import CommandPalette from "../command/CommandPalette";

export default function AppLayout() {
  const { searchOpen, setSearchOpen, tradeModalOpen, commandPaletteOpen, setCommandPaletteOpen } =
    useAppStore();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      <Sidebar activeRoute={location.pathname} onNavigate={navigate} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">
          {/* Wider than the old 5xl: the new tables (orders, derivatives,
              transactions) need the room, and narrow windows still stack. */}
          <div className="mx-auto w-full max-w-[1600px] px-8 py-8">
            <Outlet />
          </div>
        </main>
      </div>
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      {tradeModalOpen && <TradeModal />}
      {commandPaletteOpen && <CommandPalette onClose={() => setCommandPaletteOpen(false)} />}
    </div>
  );
}
