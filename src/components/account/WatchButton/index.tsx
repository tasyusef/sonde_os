import { useIntelligence } from "@/hooks/useIntelligence";
import { cn } from "@/lib/utils";
import PixelIcon from "@/components/shared/PixelIcon";

/** Toggles an account in the browser-stored watchlist. */
export default function WatchButton({
  address,
  className,
}: {
  address: string;
  className?: string;
}) {
  const { isWatched, addToWatchlist, removeFromWatchlist, watchlistLoading } = useIntelligence();
  const watched = isWatched(address);

  return (
    <button
      type="button"
      onClick={() => (watched ? removeFromWatchlist(address) : addToWatchlist(address))}
      disabled={watchlistLoading}
      aria-pressed={watched}
      aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 font-display text-caps uppercase enabled:hover:bg-primary enabled:hover:text-black disabled:opacity-60 disabled:cursor-not-allowed",
        watched ? "bg-accent text-on-accent" : "bg-dither text-primary",
        className,
      )}
    >
      <PixelIcon name={watched ? "star-filled" : "star"} size="sm" />
      {watched ? "Watching" : "Watch"}
    </button>
  );
}
