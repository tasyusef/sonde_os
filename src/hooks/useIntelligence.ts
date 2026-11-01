import { useCallback, useMemo, useSyncExternalStore } from "react";
import { watchlistStore, type WatchlistItem } from "@/lib/watchlist-store";

export type { WatchlistItem };

const noopSubscribe = () => () => {};

/**
 * The browser-stored watchlist. Works anywhere, no provider needed.
 * `watchlistLoading` is true only while hydrating: the server render
 * has no access to storage, so the list is empty until then.
 */
export function useIntelligence() {
  const watchlistItems = useSyncExternalStore(
    watchlistStore.subscribe,
    watchlistStore.getSnapshot,
    watchlistStore.getServerSnapshot,
  );
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const watchlist = useMemo(
    () => watchlistItems.map((item) => item.watchedAddress),
    [watchlistItems],
  );
  const isWatched = useCallback(
    (address: string) => watchlist.includes(address),
    [watchlist],
  );

  return {
    watchlist,
    watchlistItems,
    addToWatchlist: watchlistStore.add,
    removeFromWatchlist: watchlistStore.remove,
    isWatched,
    watchlistLoading: !hydrated,
  };
}
