import type { HistoryEntry } from "@/lib/asktheledger-history";

/** Compact relative time for the history rail. "5m", "3h", "2d", etc. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  const week = Math.round(day / 7);
  if (week < 4) return `${week}w`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export type HistoryGroup = {
  label: string;
  entries: HistoryEntry[];
};

/** Group history entries into Today / Yesterday / This week / Older buckets.
 *  Entries are assumed pre-sorted by createdAt desc. */
export function groupHistoryByDate(entries: HistoryEntry[]): HistoryGroup[] {
  const today: HistoryEntry[] = [];
  const yesterday: HistoryEntry[] = [];
  const thisWeek: HistoryEntry[] = [];
  const older: HistoryEntry[] = [];

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;

  for (const entry of entries) {
    const t = new Date(entry.createdAt).getTime();
    if (t >= startOfToday) today.push(entry);
    else if (t >= startOfYesterday) yesterday.push(entry);
    else if (t >= startOfWeek) thisWeek.push(entry);
    else older.push(entry);
  }

  return [
    { label: "Today", entries: today },
    { label: "Yesterday", entries: yesterday },
    { label: "This week", entries: thisWeek },
    { label: "Older", entries: older },
  ].filter((g) => g.entries.length > 0);
}

export type ResultKind = "chart" | "stat" | "table" | "text";

/** Tag the kind of result this entry produced — drives the small icon
 *  next to each history row. */
export function resultKind(entry: HistoryEntry): ResultKind {
  if (entry.visualization) return "chart";
  if (entry.statValue) return "stat";
  if (entry.tableData) return "table";
  return "text";
}
