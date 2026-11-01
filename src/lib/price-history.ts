/**
 * XRP/USD candles for the price chart, read from the browser: Bitstamp
 * (where the relay takes the price), with Kraken as the fallback.
 * Both send CORS headers and need no key.
 */

/** One candle: open time (unix seconds) and its prices. */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export type PriceRange = "1D" | "7D" | "1M" | "1Y" | "ALL";

export interface PriceHistory {
  range: PriceRange;
  source: "Bitstamp" | "Kraken";
  candles: Candle[];
}

const DAY = 86_400;

interface RangeSpec {
  /** Seconds shown, or null for everything. */
  span: number | null;
  /** Bitstamp candle length (seconds). */
  step: number;
  /** Kraken candle length (minutes); it returns the last 720. */
  krakenInterval: number;
  /** How often the newest candle is worth refetching. */
  refreshMs: number;
}

export const RANGES: Record<PriceRange, RangeSpec> = {
  "1D": { span: DAY, step: 300, krakenInterval: 5, refreshMs: 60_000 },
  "7D": { span: 7 * DAY, step: 1800, krakenInterval: 30, refreshMs: 5 * 60_000 },
  "1M": { span: 30 * DAY, step: 7200, krakenInterval: 240, refreshMs: 15 * 60_000 },
  "1Y": { span: 365 * DAY, step: DAY, krakenInterval: 1440, refreshMs: 60 * 60_000 },
  ALL: { span: null, step: 3 * DAY, krakenInterval: 10080, refreshMs: 60 * 60_000 },
};

/** Before Bitstamp listed XRP/USD (Dec 2016), so "All" starts at its first candle. */
const ALL_START = 1_451_606_400;
const BITSTAMP_LIMIT = 1000;
/** "All" in 3-day candles takes two pages today; this bounds the walk. */
const MAX_PAGES = 4;

function candleOf(t: unknown, o: unknown, h: unknown, l: unknown, c: unknown): Candle | null {
  const row = { t: Number(t), o: Number(o), h: Number(h), l: Number(l), c: Number(c) };
  const ok =
    Number.isFinite(row.t) &&
    [row.o, row.h, row.l, row.c].every((v) => Number.isFinite(v) && v > 0) &&
    row.h >= row.l;
  return ok ? row : null;
}

/** Sorted by time, one candle per open time. */
function tidy(candles: (Candle | null)[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) if (c) byTime.set(c.t, c);
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** Bitstamp `/api/v2/ohlc/xrpusd/` → candles. Throws on an unknown shape. */
export function parseBitstamp(json: unknown): Candle[] {
  const rows = (json as { data?: { ohlc?: unknown } } | null)?.data?.ohlc;
  if (!Array.isArray(rows)) throw new Error("Bitstamp: no candles");
  return tidy(
    rows.map((r: Record<string, unknown>) => candleOf(r?.timestamp, r?.open, r?.high, r?.low, r?.close)),
  );
}

/** Kraken `/0/public/OHLC` → candles. Throws on an error or unknown shape. */
export function parseKraken(json: unknown): Candle[] {
  const body = json as { error?: unknown[]; result?: Record<string, unknown> } | null;
  if (body?.error?.length) throw new Error(`Kraken: ${String(body.error[0])}`);
  const key = Object.keys(body?.result ?? {}).find((k) => k !== "last");
  const rows = key ? body!.result![key] : null;
  if (!Array.isArray(rows)) throw new Error("Kraken: no candles");
  return tidy(rows.map((r: unknown[]) => (Array.isArray(r) ? candleOf(r[0], r[1], r[2], r[3], r[4]) : null)));
}

/** The candles inside the range, counted back from the newest. */
export function withinRange(candles: Candle[], range: PriceRange): Candle[] {
  const { span } = RANGES[range];
  const last = candles.at(-1);
  if (span == null || !last) return candles;
  return candles.filter((c) => c.t > last.t - span);
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

const bitstampUrl = (step: number, params: string) =>
  `https://www.bitstamp.net/api/v2/ohlc/xrpusd/?step=${step}&${params}`;

async function fromBitstamp(range: PriceRange): Promise<Candle[]> {
  const { span, step } = RANGES[range];
  if (span != null) {
    return parseBitstamp(await getJson(bitstampUrl(step, `limit=${Math.ceil(span / step)}`)));
  }
  // Everything: page forward from the listing until a page reaches now.
  const all: Candle[] = [];
  let start = ALL_START;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = parseBitstamp(await getJson(bitstampUrl(step, `limit=${BITSTAMP_LIMIT}&start=${start}`)));
    all.push(...batch);
    const last = batch.at(-1);
    if (!last || last.t + 2 * step > Date.now() / 1000) break;
    start = last.t + step;
  }
  return tidy(all);
}

async function fromKraken(range: PriceRange): Promise<Candle[]> {
  const url = `https://api.kraken.com/0/public/OHLC?pair=XRPUSD&interval=${RANGES[range].krakenInterval}`;
  return withinRange(parseKraken(await getJson(url)), range);
}

/** Bitstamp, else Kraken. Throws when neither has at least two candles. */
export async function fetchPriceHistory(range: PriceRange): Promise<PriceHistory> {
  try {
    const candles = await fromBitstamp(range);
    if (candles.length >= 2) return { range, source: "Bitstamp", candles };
  } catch {
    // Fall through to Kraken.
  }
  const candles = await fromKraken(range);
  if (candles.length < 2) throw new Error("No price history");
  return { range, source: "Kraken", candles };
}

/** A candle's open time in UTC: the day, plus the time on intraday ranges. */
export function formatCandleTime(t: number, range: PriceRange): string {
  const iso = new Date(t * 1000).toISOString();
  return range === "1Y" || range === "ALL" ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

const AXIS_FORMATS: Record<PriceRange, Intl.DateTimeFormatOptions> = {
  "1D": { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  "7D": { month: "short", day: "numeric" },
  "1M": { month: "short", day: "numeric" },
  "1Y": { month: "short", year: "numeric" },
  ALL: { year: "numeric" },
};

/** A short UTC label for the time axis. */
export function formatAxisTime(t: number, range: PriceRange): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...AXIS_FORMATS[range] }).format(t * 1000);
}

/** What a range covers, said plainly: "Past 24 hours", "Since 2016". */
export function spanLabel(range: PriceRange, firstT: number): string {
  if (range === "ALL") return `Since ${new Date(firstT * 1000).getUTCFullYear()}`;
  return { "1D": "Past 24 hours", "7D": "Past 7 days", "1M": "Past 30 days", "1Y": "Past year" }[range];
}

/** A USD price to four places: "$1.2512". */
export function formatPrice(usd: number, decimals = 4): string {
  return `$${usd.toFixed(decimals)}`;
}

/** A signed percentage: "+2.31%", "-0.40%", "+18,611.34%". */
export function formatChange(pct: number): string {
  const digits = pct.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${pct >= 0 ? "+" : ""}${digits}%`;
}

type TimeUnit = "hour" | "day" | "month" | "year";

/** The calendar unit each range's axis counts in, and the strides it may take. */
const AXIS_UNITS: Record<PriceRange, { unit: TimeUnit; steps: number[] }> = {
  "1D": { unit: "hour", steps: [1, 2, 3, 4, 6, 12] },
  "7D": { unit: "day", steps: [1, 2, 7] },
  "1M": { unit: "day", steps: [1, 2, 5, 7, 10, 15] },
  "1Y": { unit: "month", steps: [1, 2, 3, 6] },
  ALL: { unit: "year", steps: [1, 2, 5, 10] },
};

/** Whole units since 1970 (UTC): hour, day, month or year number. */
function unitOf(t: number, unit: TimeUnit): number {
  if (unit === "hour") return Math.floor(t / 3600);
  if (unit === "day") return Math.floor(t / DAY);
  const d = new Date(t * 1000);
  return unit === "month" ? d.getUTCFullYear() * 12 + d.getUTCMonth() : d.getUTCFullYear();
}

function unitStart(n: number, unit: TimeUnit): number {
  if (unit === "hour") return n * 3600;
  if (unit === "day") return n * DAY;
  return (unit === "month" ? Date.UTC(Math.floor(n / 12), n % 12) : Date.UTC(n, 0)) / 1000;
}

/**
 * Round times to label the axis with (whole hours, midnights, firsts of
 * the month, new years), at most `max` of them: each is the boundary's
 * time and the first candle on or after it, where the label goes.
 */
export function timeTicks(times: number[], range: PriceRange, max: number): { i: number; t: number }[] {
  const { unit, steps } = AXIS_UNITS[range];
  let ticks: { i: number; t: number }[] = [];
  for (const step of steps) {
    ticks = [];
    for (let i = 1; i < times.length; i++) {
      const to = unitOf(times[i], unit);
      const boundary = Math.floor(to / step) * step;
      if (boundary > unitOf(times[i - 1], unit)) ticks.push({ i, t: unitStart(boundary, unit) });
    }
    if (ticks.length <= max) break;
  }
  return ticks;
}
