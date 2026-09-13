import { create } from "zustand";
import type { CapabilitiesData, TradeSide, WhoamiData } from "../api/types";

interface AppState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: WhoamiData | null;
  capabilities: CapabilitiesData | null;

  activePortfolioId: string | null;
  /** Every portfolio the account can select, for the header switcher. */
  availablePortfolios: string[];
  // Set when the account has several portfolios and none is selected yet:
  // the app blocks on a picker until `sc broker context` is persisted.
  needsPortfolioSelection: boolean;

  searchOpen: boolean;
  commandPaletteOpen: boolean;

  tradeModalOpen: boolean;
  tradeModalSide: TradeSide;
  tradeModalIsin: string | null;
  /** Pre-fills the ticket when a screen proposes a size (e.g. rebalancing). */
  tradeModalPrefill: { amount?: string; shares?: string } | null;

  /**
   * Bumped to make every mounted screen refetch. Screens include it in their
   * effect deps so one refresh action reloads the whole app consistently.
   */
  refreshToken: number;

  setAuthenticated: (val: boolean) => void;
  setLoading: (val: boolean) => void;
  setUser: (user: WhoamiData | null) => void;
  setCapabilities: (caps: CapabilitiesData | null) => void;
  setActivePortfolioId: (id: string | null) => void;
  setAvailablePortfolios: (ids: string[]) => void;
  setPortfolioSelection: (needed: boolean, portfolios: string[]) => void;
  setSearchOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  openTradeModal: (
    side: TradeSide,
    isin?: string,
    prefill?: { amount?: string; shares?: string }
  ) => void;
  closeTradeModal: () => void;
  refresh: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  isAuthenticated: false,
  isLoading: false,
  user: null,
  capabilities: null,

  activePortfolioId: null,
  availablePortfolios: [],
  needsPortfolioSelection: false,

  searchOpen: false,
  commandPaletteOpen: false,

  tradeModalOpen: false,
  tradeModalSide: "buy",
  tradeModalIsin: null,
  tradeModalPrefill: null,

  refreshToken: 0,

  setAuthenticated: (val) => set({ isAuthenticated: val }),
  setLoading: (val) => set({ isLoading: val }),
  setUser: (user) => set({ user }),
  setCapabilities: (caps) => set({ capabilities: caps }),
  setActivePortfolioId: (id) => set({ activePortfolioId: id }),
  setAvailablePortfolios: (ids) => set({ availablePortfolios: ids }),
  setPortfolioSelection: (needed, portfolios) =>
    set({ needsPortfolioSelection: needed, availablePortfolios: portfolios }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  openTradeModal: (side, isin, prefill) =>
    set({
      tradeModalOpen: true,
      tradeModalSide: side,
      tradeModalIsin: isin ?? null,
      tradeModalPrefill: prefill ?? null,
    }),
  closeTradeModal: () =>
    set({ tradeModalOpen: false, tradeModalIsin: null, tradeModalPrefill: null }),
  refresh: () => set((s) => ({ refreshToken: s.refreshToken + 1 })),
}));
