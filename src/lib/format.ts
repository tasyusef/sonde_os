/** Format a date string as a relative time ("2m ago", "3h ago", "1d ago"). */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Format an XRP amount with K/M suffix. Works with negative values. */
export function formatXrp(n: number): string {
  if (!Number.isFinite(n)) return "0 XRP";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M XRP`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K XRP`;
  return `${sign}${Math.round(abs).toLocaleString()} XRP`;
}

/** Format an XRP value with K/M suffix (no unit label). Used by chart tick formatters. */
export function formatXrpValue(xrp: number): string {
  if (!Number.isFinite(xrp)) return "0";
  if (xrp === 0) return "0";
  const abs = Math.abs(xrp);
  const sign = xrp < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `${sign}${abs.toFixed(1)}`;
  if (abs >= 0.01) return `${sign}${abs.toFixed(2)}`;
  return `${sign}${abs.toFixed(3)}`;
}

/** Format a USD volume amount with K/M/B suffix. */
export function formatVolume(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

/**
 * Format a UTC timestamp for chart X-axis ticks. Returns "h:mm a" when
 * showTime is true (intraday window) and "Mon DD" otherwise (multi-day).
 * Used by every time-series chart in network/, portfolio/, etc.
 */
export function formatChartDateTick(ts: number, showTime: boolean): string {
  const d = new Date(ts);
  if (showTime) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
