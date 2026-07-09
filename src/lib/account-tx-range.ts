/**
 * Shared helpers for the date-range filter on the account-page tx list.
 * Used by the server page render, the API route, and the client chip
 * strip — keeping the range vocabulary in one place so URL state, query
 * params, and SQL bounds stay aligned.
 *
 * Semantics:
 *   - Relative chips (`24h`, `7d`, `30d`, `90d`, `1y`) mean "last N from
 *     now." `from` is `now - N`, `to` is undefined (no upper bound — the
 *     stream is naturally capped at "tip" by the data).
 *   - `all` skips the filter entirely. Effectively unbounded.
 *   - `custom` reads `from` / `to` query params (YYYY-MM-DD), interpreted
 *     as inclusive UTC days (00:00:00 → 23:59:59).
 *
 * The CH-friendly format is `YYYY-MM-DD HH:MM:SS` (no T, no Z) — that's
 * what the `DateTime` parameter binding expects. `toCHDateTime()` handles
 * the conversion from a JS Date.
 */

export const RANGE_KEYS = ["24h", "7d", "30d", "90d", "1y", "all"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const DEFAULT_RANGE: RangeKey = "30d";

/** Whether the URL search state encodes a custom range (from/to ISO dates)
 *  rather than one of the preset keys. */
export interface CustomRange {
  from: string;
  to: string;
}

export interface ResolvedRange {
  /** CH `DateTime` literal — `YYYY-MM-DD HH:MM:SS`. Inclusive lower bound. */
  fromTs?: string;
  /** CH `DateTime` literal — `YYYY-MM-DD HH:MM:SS`. Inclusive upper bound. */
  toTs?: string;
}

const MS_PER_DAY = 86_400_000;

/** Turn a JS Date into a CH-friendly DateTime string in UTC. */
function toCHDateTime(d: Date): string {
  // ISO is `YYYY-MM-DDTHH:MM:SS.sssZ`; CH wants the same up to seconds
  // without the `T` or `Z`.
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/** Resolve a relative-range chip into absolute CH timestamps. */
export function resolveRelativeRange(range: RangeKey, now: Date = new Date()): ResolvedRange {
  if (range === "all") return {};
  const days = relativeDays(range);
  if (days == null) return {};
  const from = new Date(now.getTime() - days * MS_PER_DAY);
  return { fromTs: toCHDateTime(from) };
}

/** Resolve a custom YYYY-MM-DD pair into inclusive CH timestamps. Returns
 *  `null` when either bound is missing or invalid (caller treats that as
 *  "fall back to default"). */
export function resolveCustomRange(custom: Partial<CustomRange>): ResolvedRange | null {
  const { from, to } = custom;
  if (!from || !to) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  // Inclusive day bounds in UTC. Picking 23:59:59 (not the next-day
  // 00:00:00) keeps the stop strictly within the user-named day.
  const fromTs = `${from} 00:00:00`;
  const toTs = `${to} 23:59:59`;
  // Sanity: from must be <= to. Swap silently — friendlier than an error.
  if (fromTs > toTs) return { fromTs: toTs.slice(0, 10) + " 00:00:00", toTs: fromTs.slice(0, 10) + " 23:59:59" };
  return { fromTs, toTs };
}

function relativeDays(range: RangeKey): number | null {
  switch (range) {
    case "24h":
      return 1;
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "1y":
      return 365;
    case "all":
      return null;
  }
}

/** Parse a `range` query-string value back into a RangeKey, defaulting to
 *  `DEFAULT_RANGE` when the value is missing or unrecognized. */
export function parseRangeKey(raw: string | null | undefined): RangeKey {
  if (!raw) return DEFAULT_RANGE;
  return (RANGE_KEYS as readonly string[]).includes(raw) ? (raw as RangeKey) : DEFAULT_RANGE;
}

/** Resolve the URL search params to absolute CH timestamps. `from`/`to`
 *  win over `range` when both are provided (matches custom-chip semantics
 *  in the UI). */
export function resolveFromSearchParams(searchParams: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}): ResolvedRange {
  const custom = resolveCustomRange({
    from: searchParams.from ?? undefined,
    to: searchParams.to ?? undefined,
  });
  if (custom) return custom;
  return resolveRelativeRange(parseRangeKey(searchParams.range));
}

/** True when the search params mean "custom range." Used by the chip
 *  strip to decide which chip is highlighted. */
export function isCustomRange(searchParams: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}): boolean {
  return resolveCustomRange({
    from: searchParams.from ?? undefined,
    to: searchParams.to ?? undefined,
  }) != null;
}

/** Active chip and custom date strings derived from URL search params.
 *  Same vocabulary the chip strip renders — `"custom"` plus a from/to
 *  pair, or one of the preset RangeKeys with empty strings. Server uses
 *  this to compute the initial UI state to thread to the client; the
 *  client mounts with the same values for a clean hydration. */
export function chipStateFromSearchParams(searchParams: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}): { chip: RangeKey | "custom"; from: string; to: string } {
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";
  if (
    from &&
    to &&
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to)
  ) {
    return { chip: "custom", from, to };
  }
  return { chip: parseRangeKey(searchParams.range), from: "", to: "" };
}
