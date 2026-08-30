import { create } from "zustand";
import type { WhoamiData, CapabilitiesData } from "../api/types";

interface AppState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: WhoamiData | null;
  capabilities: CapabilitiesData | null;
  activePortfolioId: string | null;
  activeRoute: string;
  searchOpen: boolean;
  tradeModalOpen: boolean;
  tradeModalSide: "buy" | "sell";
  tradeModalIsin: string | null;
  selectedSecurityIsin: string | null;

  setAuthenticated: (val: boolean) => void;
  setLoading: (val: boolean) => void;
  setUser: (user: WhoamiData | null) => void;
  setCapabilities: (caps: CapabilitiesData | null) => void;
  setActivePortfolioId: (id: string | null) => void;
  setActiveRoute: (route: string) => void;
  setSearchOpen: (open: boolean) => void;
  openTradeModal: (side: "buy" | "sell", isin?: string) => void;
  closeTradeModal: () => void;
  setSelectedSecurityIsin: (isin: string | null) => void;
  addToWatchlist: (isin: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  isAuthenticated: false,
  isLoading: false,
  user: null,
  capabilities: null,
  activePortfolioId: null,
  activeRoute: "/",
  searchOpen: false,
  tradeModalOpen: false,
  tradeModalSide: "buy",
  tradeModalIsin: null,
  selectedSecurityIsin: null,

  setAuthenticated: (val) => set({ isAuthenticated: val }),
  setLoading: (val) => set({ isLoading: val }),
  setUser: (user) => set({ user }),
  setCapabilities: (caps) => set({ capabilities: caps }),
  setActivePortfolioId: (id) => set({ activePortfolioId: id }),
  setActiveRoute: (route) => set({ activeRoute: route }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  openTradeModal: (side, isin) =>
    set({ tradeModalOpen: true, tradeModalSide: side, tradeModalIsin: isin || null }),
  closeTradeModal: () =>
    set({ tradeModalOpen: false, tradeModalIsin: null }),
  setSelectedSecurityIsin: (isin) => set({ selectedSecurityIsin: isin }),
  addToWatchlist: async (isin: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("add_to_watchlist", { isin });
  },
}));
