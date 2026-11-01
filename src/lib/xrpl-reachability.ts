/**
 * Whether the XRP Ledger can be reached: "unreachable" once no socket
 * has been open for `afterMs`, counted from start, from the last drop,
 * or from a manual retry. Pages with nothing to show say so instead of
 * a skeleton that never resolves (before the first connection, queries
 * don't even start).
 */
export interface Reachability {
  /** Report a socket status change. */
  status: (connected: boolean) => void;
  /** Clear the flag and restart the clock. False when already connected. */
  retry: () => boolean;
  stop: () => void;
}

export function watchReachability(
  afterMs: number,
  onChange: (unreachable: boolean) => void,
): Reachability {
  let open = false;
  let unreachable = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (value: boolean) => {
    if (value === unreachable) return;
    unreachable = value;
    onChange(value);
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      set(true);
    }, afterMs);
  };

  arm();
  return {
    status(connected) {
      open = connected;
      if (connected) {
        clear();
        set(false);
      } else if (!timer && !unreachable) {
        arm();
      }
    },
    retry() {
      if (open) return false;
      set(false);
      arm();
      return true;
    },
    stop: clear,
  };
}
