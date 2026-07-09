"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";

export type AiProvider = "anthropic" | "google" | "openai";

export interface WatchlistItem {
  watchedAddress: string;
  label: string | null;
}

interface IntelligenceContextValue {
  /** Currently selected account across all intel tabs */
  activeAccount: string | null;
  setActiveAccount: (address: string | null) => void;
  /** Watchlist of tracked accounts */
  watchlist: string[];
  watchlistItems: WatchlistItem[];
  addToWatchlist: (address: string, label?: string) => void;
  removeFromWatchlist: (address: string) => void;
  isWatched: (address: string) => boolean;
  watchlistLoading: boolean;
  /** AI provider + key management */
  aiProvider: AiProvider;
  setAiProvider: (provider: AiProvider) => void;
  hasApiKey: boolean;
  setApiKey: (key: string) => void;
  getApiKey: () => string | null;
  clearApiKey: () => void;
}

const IntelligenceContext = createContext<IntelligenceContextValue | null>(null);

const WATCHLIST_KEY = "sonde_intel_watchlist";
const AI_PROVIDER_KEY = "sonde_intel_ai_provider";
const aiKeyStorageKey = (provider: AiProvider) => `sonde_intel_ai_key_${provider}`;

export function IntelligenceProvider({ children }: { children: ReactNode }) {
  const { address: authAddress } = useAuth();
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [watchlistItemsState, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const hydratedRef = useRef(false);

  // Derive simple address list from items
  const watchlist = watchlistItemsState.map((item) => item.watchedAddress);

  // For unauthenticated users, fall back to sessionStorage
  const [localWatchlist, setLocalWatchlist] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = sessionStorage.getItem(WATCHLIST_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.filter((x: unknown) => typeof x === "string") : [];
    } catch { return []; }
  });

  const isAuthenticated = !!authAddress;

  // Hydrate watchlist from API when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      hydratedRef.current = false;
      return;
    }
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    let cancelled = false;
    fetch("/api/intel/watchlist")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled) return;
        if (data?.items) {
          setWatchlistItems(data.items.map((item: { watchedAddress: string; label: string | null }) => ({
            watchedAddress: item.watchedAddress,
            label: item.label,
          })));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setWatchlistLoading(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // Persist local watchlist to sessionStorage (unauthenticated fallback)
  useEffect(() => {
    if (isAuthenticated) return;
    try {
      sessionStorage.setItem(WATCHLIST_KEY, JSON.stringify(localWatchlist));
    } catch { /* ignore */ }
  }, [localWatchlist, isAuthenticated]);

  const addToWatchlist = useCallback((address: string, label?: string) => {
    if (isAuthenticated) {
      // Optimistic update + API call
      setWatchlistItems((prev) =>
        prev.some((item) => item.watchedAddress === address)
          ? prev
          : [...prev, { watchedAddress: address, label: label ?? null }],
      );
      fetch("/api/intel/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, label }),
      }).catch(() => {
        // Revert on failure
        setWatchlistItems((prev) => prev.filter((item) => item.watchedAddress !== address));
      });
    } else {
      setLocalWatchlist((prev) => prev.includes(address) ? prev : [...prev, address]);
    }
  }, [isAuthenticated]);

  const removeFromWatchlist = useCallback((address: string) => {
    if (isAuthenticated) {
      // Optimistic update + API call
      setWatchlistItems((prev) => prev.filter((item) => item.watchedAddress !== address));
      fetch("/api/intel/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      }).catch(() => {
        // Re-fetch on failure to restore accurate state
        fetch("/api/intel/watchlist")
          .then((r) => r.ok ? r.json() : null)
          .then((data) => data?.items && setWatchlistItems(data.items))
          .catch(() => {});
      });
    } else {
      setLocalWatchlist((prev) => prev.filter((a) => a !== address));
    }
  }, [isAuthenticated]);

  // Use authenticated watchlist if signed in, else local
  const effectiveWatchlist = isAuthenticated ? watchlist : localWatchlist;
  const effectiveItems = isAuthenticated
    ? watchlistItemsState
    : localWatchlist.map((addr) => ({ watchedAddress: addr, label: null }));

  const isWatched = useCallback(
    (address: string) => effectiveWatchlist.includes(address),
    [effectiveWatchlist],
  );

  // AI provider state
  const [aiState, setAiState] = useState(() => {
    if (typeof window === "undefined") return { provider: "anthropic" as AiProvider, hasKey: false };
    const stored = localStorage.getItem(AI_PROVIDER_KEY);
    const provider: AiProvider = (stored === "anthropic" || stored === "google" || stored === "openai") ? stored : "anthropic";
    return { provider, hasKey: !!sessionStorage.getItem(aiKeyStorageKey(provider)) };
  });

  const aiProvider = aiState.provider;
  const hasApiKey = aiState.hasKey;

  const setAiProvider = useCallback((provider: AiProvider) => {
    try { localStorage.setItem(AI_PROVIDER_KEY, provider); } catch { /* ignore */ }
    setAiState({
      provider,
      hasKey: !!sessionStorage.getItem(aiKeyStorageKey(provider)),
    });
  }, []);

  const setApiKey = useCallback((key: string) => {
    try { sessionStorage.setItem(aiKeyStorageKey(aiProvider), key); } catch { /* ignore */ }
    setAiState((prev) => ({ ...prev, hasKey: true }));
  }, [aiProvider]);

  const getApiKey = useCallback(() => {
    try { return sessionStorage.getItem(aiKeyStorageKey(aiProvider)); } catch { return null; }
  }, [aiProvider]);

  const clearApiKey = useCallback(() => {
    try { sessionStorage.removeItem(aiKeyStorageKey(aiProvider)); } catch { /* ignore */ }
    setAiState((prev) => ({ ...prev, hasKey: false }));
  }, [aiProvider]);

  return (
    <IntelligenceContext.Provider
      value={{
        activeAccount,
        setActiveAccount,
        watchlist: effectiveWatchlist,
        watchlistItems: effectiveItems,
        addToWatchlist,
        removeFromWatchlist,
        isWatched,
        watchlistLoading,
        aiProvider,
        setAiProvider,
        hasApiKey,
        setApiKey,
        getApiKey,
        clearApiKey,
      }}
    >
      {children}
    </IntelligenceContext.Provider>
  );
}

export function useIntelligence() {
  const ctx = useContext(IntelligenceContext);
  if (!ctx) throw new Error("useIntelligence must be used within IntelligenceProvider");
  return ctx;
}
