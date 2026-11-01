import { useSyncExternalStore } from "react";
import { LedgerReadout } from "./LedgerReadout";
import { NodeName } from "./NodeName";

/* One interval for every clock on the page, running only while one is mounted. */
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  clockTimer ??= setInterval(() => clockListeners.forEach((l) => l()), 1000);
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** HH:MM:SS in UTC, the ledger's own clock. Blank in the prerender. */
function UtcClock() {
  const seconds = useSyncExternalStore(subscribeClock, nowSeconds, () => null);
  const time = seconds == null ? "--:--:--" : new Date(seconds * 1000).toISOString().slice(11, 19);
  return (
    <span aria-hidden="true" className="ml-auto shrink-0 tabular-nums">
      {time} UTC
    </span>
  );
}

/**
 * The readout above the search bar, level with the sidebar's mark: the
 * network's state, the node and the time. Desktop only; the mobile
 * header carries a compact readout.
 */
export default function StatusStrip() {
  return (
    <div className="hidden h-14 items-center gap-8 overflow-hidden whitespace-nowrap px-6 font-mono text-body text-muted md:flex">
      <LedgerReadout />
      {/* From `lg`, where the strip has room. */}
      <NodeName className="hidden min-w-0 truncate lg:inline" />
      <UtcClock />
    </div>
  );
}
