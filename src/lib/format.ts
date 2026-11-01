import { XRPL_EPOCH } from "./xrpl-helpers";

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

/** How long an account has existed, from its activation (XRPL epoch
 *  seconds): whole years once it's a year old, else whole days. */
export function accountAge(activated: number, nowMs: number): string {
  const days = Math.max(0, Math.floor((nowMs - (activated + XRPL_EPOCH) * 1000) / 86_400_000));
  const [n, unit] = days >= 365 ? [Math.floor(days / 365), "year"] : [days, "day"];
  return `${n.toLocaleString("en-US")} ${unit}${n === 1 ? "" : "s"}`;
}

/** One step of a compact-number scale, e.g. `{ div: 1e3, suffix: "K", decimals: 1 }`. */
interface CompactUnit {
  div: number;
  suffix: string;
  /** Decimals shown at this step. */
  decimals: number;
}

/**
 * Pick the compact unit for a non-negative number AFTER rounding, so a value
 * that rounds up across a boundary is promoted: 999,999 at 1 decimal in K
 * would print "1000.0K", so it moves to M instead ("1.00M").
 *
 * `units` must be sorted ascending by `div`; the first entry is the base unit
 * (usually `div: 1`, no suffix) and its `decimals` should match how the
 * caller formats unsuffixed values. Returns the chosen unit and `abs / div`.
 */
function pickCompactUnit(
  abs: number,
  units: readonly CompactUnit[],
): { unit: CompactUnit; scaled: number } {
  let i = 0;
  while (i < units.length - 1 && abs >= units[i + 1].div) i++;
  while (i < units.length - 1) {
    const { div, decimals } = units[i];
    const rounded = Number((abs / div).toFixed(decimals));
    if (rounded * div < units[i + 1].div) break;
    i++;
  }
  return { unit: units[i], scaled: abs / units[i].div };
}

/** True when `value` rounds to zero at `decimals`, so no minus sign should show. */
function roundsToZero(value: number, decimals: number): boolean {
  return Number(Math.abs(value).toFixed(decimals)) === 0;
}

interface CompactOptions {
  /** Decimals on every suffixed step. Default: 1 on K, 2 on M/B/T. */
  decimals?: number;
  /** Fixed decimals below 1,000. Default: locale format with up to 2 decimals ("12", "0.5"). */
  baseDecimals?: number;
  /** Text between the sign and the number ("$" gives "-$1.5K"). */
  prefix?: string;
  /** Text after the unit suffix (" XRP" gives "1.5K XRP"). */
  suffix?: string;
  /** SI-style lowercase thousands ("1.5k"). */
  lowercaseK?: boolean;
  /** Drop trailing zeros on suffixed values ("1.2M", not "1.20M"). */
  trimZeros?: boolean;
}

interface CompactStyle extends Pick<CompactOptions, "prefix" | "suffix" | "trimZeros"> {
  /** Format unsuffixed values with the locale (up to the base unit's decimals) instead of `toFixed`. */
  localeBase?: boolean;
}

/** Shared core: rounding-aware unit pick, a sign that never shows on zero, then layout. */
function formatCompactWith(n: number, units: readonly CompactUnit[], style: CompactStyle): string {
  const { unit, scaled } = pickCompactUnit(Math.abs(n), units);
  const sign = n < 0 && !roundsToZero(scaled, unit.decimals) ? "-" : "";
  let body: string;
  if (unit.suffix) {
    body = scaled.toFixed(unit.decimals);
    if (style.trimZeros && body.includes(".")) body = body.replace(/\.?0+$/, "");
  } else if (style.localeBase) {
    body = scaled.toLocaleString(undefined, { maximumFractionDigits: unit.decimals });
  } else {
    body = scaled.toFixed(unit.decimals);
  }
  return `${sign}${style.prefix ?? ""}${body}${unit.suffix}${style.suffix ?? ""}`;
}

const COMPACT_UNITS: readonly CompactUnit[] = [
  { div: 1, suffix: "", decimals: 2 },
  { div: 1e3, suffix: "K", decimals: 1 },
  { div: 1e6, suffix: "M", decimals: 2 },
  { div: 1e9, suffix: "B", decimals: 2 },
  { div: 1e12, suffix: "T", decimals: 2 },
];

/**
 * Compact K/M/B/T formatting ("1.5K", "2.34M", "-$3.1B"). The suffix is
 * picked after rounding, so 999,999 renders "1.00M", not "1000.0K", and a
 * negative value that rounds to zero never shows "-0". Missing or
 * non-finite input renders "—".
 */
export function formatCompactNumber(
  n: number | null | undefined,
  options: CompactOptions = {},
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const { decimals, baseDecimals, lowercaseK } = options;
  const units =
    decimals === undefined && baseDecimals === undefined && !lowercaseK
      ? COMPACT_UNITS
      : COMPACT_UNITS.map((u, i) =>
          i === 0
            ? { ...u, decimals: baseDecimals ?? u.decimals }
            : {
                ...u,
                suffix: lowercaseK && u.suffix === "K" ? "k" : u.suffix,
                decimals: decimals ?? u.decimals,
              },
        );
  return formatCompactWith(n, units, {
    prefix: options.prefix,
    suffix: options.suffix,
    trimZeros: options.trimZeros,
    localeBase: baseDecimals === undefined,
  });
}

/** Compact counts (wallets, txns, views): one decimal on every step ("12.5K", "3.4M"). */
export function formatCompactCount(n: number): string {
  return formatCompactNumber(n, { decimals: 1 });
}

const XRP_UNITS: readonly CompactUnit[] = [
  { div: 1, suffix: "", decimals: 0 },
  { div: 1e3, suffix: "K", decimals: 1 },
  { div: 1e6, suffix: "M", decimals: 2 },
];

/** Format an XRP amount with K/M suffix. Works with negative values. */
export function formatXrp(n: number): string {
  if (!Number.isFinite(n)) return "0 XRP";
  return formatCompactWith(n, XRP_UNITS, { suffix: " XRP", localeBase: true });
}

const XRP_VALUE_UNITS: readonly CompactUnit[] = [
  { div: 1, suffix: "", decimals: 1 },
  { div: 1e3, suffix: "K", decimals: 1 },
  { div: 1e6, suffix: "M", decimals: 1 },
];
// Sub-1 values keep extra precision and can never reach the K boundary.
const XRP_CENTS_UNITS: readonly CompactUnit[] = [{ div: 1, suffix: "", decimals: 2 }];
const XRP_MILLIS_UNITS: readonly CompactUnit[] = [{ div: 1, suffix: "", decimals: 3 }];

/** Format an XRP value with K/M suffix (no unit label). Used by chart tick formatters. */
export function formatXrpValue(xrp: number): string {
  if (!Number.isFinite(xrp)) return "0";
  if (xrp === 0) return "0";
  const abs = Math.abs(xrp);
  const units = abs >= 1 ? XRP_VALUE_UNITS : abs >= 0.01 ? XRP_CENTS_UNITS : XRP_MILLIS_UNITS;
  return formatCompactWith(xrp, units, {});
}

const VOLUME_UNITS: readonly CompactUnit[] = [
  { div: 1, suffix: "", decimals: 2 },
  { div: 1e3, suffix: "K", decimals: 1 },
  { div: 1e6, suffix: "M", decimals: 2 },
  { div: 1e9, suffix: "B", decimals: 2 },
];

/** Format a USD volume amount with K/M/B suffix. */
export function formatVolume(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatCompactWith(n, VOLUME_UNITS, { prefix: "$" });
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

// Fixed locale: these run in server and client components, and a viewer-locale
// default would render "1.234" on the client after "1,234" on the server.
const INTEGER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * Group an integer with thousands separators ("107,964,754"). Numeric strings
 * are accepted because rippled's API v1 returns `ledger_index` as a string,
 * and go through BigInt so large values stay exact. Numbers are rounded.
 * Missing, non-finite or non-integer-string input renders "—".
 */
export function formatInteger(value: number | string | bigint | null | undefined): string {
  if (value == null) return "—";
  if (typeof value === "bigint") return INTEGER_FORMAT.format(value);
  if (typeof value === "string") {
    const s = value.trim();
    return /^-?\d+$/.test(s) ? INTEGER_FORMAT.format(BigInt(s)) : "—";
  }
  if (!Number.isFinite(value)) return "—";
  // `|| 0` folds -0 into 0 so -0.4 never prints "-0".
  return INTEGER_FORMAT.format(Math.round(value) || 0);
}

/**
 * A drops value as an exact BigInt, or `null` when it isn't a whole number
 * (drops never have a fraction). Strings parse without a float, so 17-digit
 * ledger totals keep every digit.
 */
export function parseDrops(drops: string | number | bigint | null | undefined): bigint | null {
  if (typeof drops === "bigint") return drops;
  if (typeof drops === "number") return Number.isInteger(drops) ? BigInt(drops) : null;
  if (typeof drops !== "string") return null;
  const s = drops.trim();
  return /^-?\d+$/.test(s) ? BigInt(s) : null;
}

/**
 * Exact drops → grouped XRP ("99,985,579,589.399746"), no unit. Works in
 * BigInt because ledger totals carry 17 significant digits and a float drops
 * the last ones. The whole part is grouped with Intl.NumberFormat; the
 * fraction keeps at most the 6 digits a drop allows, trailing zeros trimmed.
 * Non-integer or missing input renders "—".
 */
export function formatDropsAsXrp(drops: string | number | bigint | null | undefined): string {
  return formatScaled(parseDrops(drops), 6);
}

/**
 * An integer amount with `scale` implied decimals, grouped and exact
 * (`formatScaled(1234500n, 2)` → "12,345"): drops are scale 6, an MPT
 * carries its own `AssetScale`. Trailing zeros are trimmed. Null renders
 * "—".
 */
export function formatScaled(n: bigint | null, scale: number): string {
  if (n === null) return "—";
  const abs = n < 0n ? -n : n;
  const unit = 10n ** BigInt(scale);
  const whole = INTEGER_FORMAT.format(abs / unit);
  const frac = scale > 0 ? (abs % unit).toString().padStart(scale, "0").replace(/0+$/, "") : "";
  return `${n < 0n ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Split a formatted timestamp ("2026-10-28 19:38:30 UTC") at its first space,
 * so each half can stay unbroken (`whitespace-nowrap`) and a narrow cell wraps
 * between the date and the time instead of inside a number. A string with no
 * space comes back whole as `date`.
 */
export function splitDateTime(formatted: string): { date: string; time: string } {
  const s = formatted.trim();
  const i = s.indexOf(" ");
  return i === -1 ? { date: s, time: "" } : { date: s.slice(0, i), time: s.slice(i + 1) };
}
