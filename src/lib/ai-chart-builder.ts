import type { Visualization, StatValue, TableData } from "@/types/intel";

/**
 * Deterministic chart builder. Given an array of row objects, inspect the
 * shape and emit a Visualization config, or null if nothing chartable was
 * detected. No LLM calls — fast, cheap, predictable.
 *
 * Used by /api/intel/query to chart SQL rows, and by /api/portfolio/query
 * to chart the user's own snapshot history.
 */

type Row = Record<string, unknown>;

interface NumericCol {
  key: string;
  label: string;
  /** "drops" triggers divide-by-1e6 for XRP amounts; "number" stays as-is. */
  kind: "drops" | "number";
}

interface TimestampCol {
  key: string;
  label: string;
}

interface CategoryCol {
  key: string;
  label: string;
}

/** Column names that indicate a time axis. */
const TIME_COL_RE = /^(snapshot_time|timestamp|time|date|day|hour|week|month|year|ts|created_at|updated_at|_at)$|_(time|date|at|ts|hour|day|week|month)$/i;

/** Column names that contain XRPL drops — divide by 1e6 for display. */
const DROPS_COL_RE = /(^|_)drops?$|_drops$/i;

/** Columns that look like identifiers and should not be charted on the y-axis. */
const ID_COL_RE = /^(id|_id|hash|tx_hash|ledger|ledger_index|sequence|seq|nonce|account|address|issuer|destination|taker|maker|wallet)$|(^|_)(id|hash|index|address|account|issuer|sequence)$/i;

function toLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function isTimestampValue(v: unknown): boolean {
  if (v instanceof Date) return !isNaN(v.getTime());
  if (typeof v === "string") {
    if (v.length < 8) return false;
    const d = new Date(v);
    return !isNaN(d.getTime());
  }
  // Unix seconds between 2001 and 2033
  if (typeof v === "number") return v > 1_000_000_000 && v < 2_000_000_000;
  return false;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeTimestampValue(v: unknown): string | unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" && v > 1e9 && v < 1e13) {
    // Unix seconds
    return new Date(v * 1000).toISOString();
  }
  return v;
}

interface Classification {
  timestampCols: TimestampCol[];
  numericCols: NumericCol[];
  categoryCols: CategoryCol[];
}

function classifyColumns(rows: Row[]): Classification {
  const timestampCols: TimestampCol[] = [];
  const numericCols: NumericCol[] = [];
  const categoryCols: CategoryCol[] = [];

  const cols = Object.keys(rows[0] ?? {});
  const sample = rows.slice(0, 25);

  for (const col of cols) {
    const vals = sample.map((r) => r[col]);
    const nonNull = vals.filter((v) => v != null);
    if (nonNull.length === 0) continue;

    const looksTime = TIME_COL_RE.test(col) && nonNull.every(isTimestampValue);
    if (looksTime) {
      timestampCols.push({ key: col, label: toLabel(col) });
      continue;
    }

    const numerics = nonNull.map(toNumber).filter((n): n is number => n != null);
    const allNumeric = numerics.length === nonNull.length;

    if (allNumeric) {
      if (ID_COL_RE.test(col)) {
        // Identifier-like numerics aren't meaningful y-axis values; treat as
        // categorical so they can appear as labels but not as bars.
        categoryCols.push({ key: col, label: toLabel(col) });
      } else {
        numericCols.push({
          key: col,
          label: toLabel(col),
          kind: DROPS_COL_RE.test(col) ? "drops" : "number",
        });
      }
    } else {
      categoryCols.push({ key: col, label: toLabel(col) });
    }
  }

  return { timestampCols, numericCols, categoryCols };
}

function normalizeRows(rows: Row[], cls: Classification): Row[] {
  return rows.map((r) => {
    const out: Row = { ...r };
    for (const tc of cls.timestampCols) {
      out[tc.key] = normalizeTimestampValue(r[tc.key]);
    }
    for (const nc of cls.numericCols) {
      if (nc.kind === "drops") {
        const n = toNumber(r[nc.key]);
        if (n != null) out[nc.key] = n / 1_000_000;
      } else {
        const n = toNumber(r[nc.key]);
        if (n != null) out[nc.key] = n;
      }
    }
    return out;
  });
}

function pickCategoryCol(cls: Classification, rowCount: number, rows: Row[]): CategoryCol | null {
  // Prefer a low-cardinality categorical for the x-axis. Skip columns whose
  // values are all unique when rowCount > 10 (they look like IDs/hashes).
  const ranked = cls.categoryCols
    .map((c) => {
      const uniq = new Set(rows.map((r) => String(r[c.key] ?? "")));
      return { ...c, cardinality: uniq.size };
    })
    .filter((c) => !(c.cardinality === rowCount && rowCount > 10))
    .sort((a, b) => a.cardinality - b.cardinality);
  return ranked[0] ?? null;
}

export interface BuildChartOptions {
  /** Optional title. If absent, one is derived from the column labels. */
  titleHint?: string;
  /**
   * Nudge toward a specific chart shape when the data could go either way:
   * - "pie": proportional breakdown at a single point in time (≤ 8 rows,
   *   1 numeric, no timestamp). When the data ALSO has a timestamp column,
   *   the builder auto-promotes to "stacked-area" since "share over time"
   *   is the temporal version of the same intent.
   * - "stacked-area": share-of-whole over time. Triggers a pivot from
   *   long-format `(timestamp, category, value)` rows into wide-format
   *   rows with one column per category, then renders each series as a
   *   stacked area.
   * - "bar": force categorical bar even when pie would also fit.
   * Ignored when no timestamp / numeric columns are detected.
   */
  preferredShape?: "pie" | "stacked-area" | "bar";
}

/**
 * Pivot long-format `(timestamp, category, value)` rows into wide-format.
 * Used when a query returns one row per (time bucket × category) — common
 * for "share over time" / "trend by token" questions.
 *
 * Example input rows:
 *   { day: "2026-04-01", currency: "RLUSD", volume: 12345 }
 *   { day: "2026-04-01", currency: "USD",   volume:  6789 }
 *   { day: "2026-04-02", currency: "RLUSD", volume: 12500 }
 *
 * Output rows:
 *   { day: "2026-04-01", RLUSD: 12345, USD:  6789 }
 *   { day: "2026-04-02", RLUSD: 12500, USD:     0 }   // missing → 0 so stacks render cleanly
 *
 * Returns null if pivot doesn't apply (cardinality out of range, gaps too
 * dense, etc.). Caller should fall back to non-pivoted handling.
 */
function pivotLongToWide(
  rows: Row[],
  tsKey: string,
  catKey: string,
  valueKey: string,
): { rows: Row[]; series: { dataKey: string; label: string }[] } | null {
  const buckets = new Map<string, Row>();
  const categories = new Set<string>();
  for (const r of rows) {
    const ts = r[tsKey];
    const cat = String(r[catKey] ?? "").trim();
    const val = toNumber(r[valueKey]);
    if (ts == null || ts === "" || !cat || val == null) continue;
    categories.add(cat);
    const tsString = String(ts);
    if (!buckets.has(tsString)) buckets.set(tsString, { [tsKey]: ts });
    buckets.get(tsString)![cat] = val;
  }
  // Cardinality guard — too few categories defeats the purpose, too many
  // makes the stacked area unreadable.
  if (categories.size < 2 || categories.size > 8) return null;
  // Fill missing (timestamp × category) cells with 0 so the stacked area
  // doesn't show jagged gaps where one category briefly went silent.
  for (const row of buckets.values()) {
    for (const cat of categories) {
      if (!(cat in row)) row[cat] = 0;
    }
  }
  // Sort timestamps ascending — stacked area depends on temporal order.
  const sortedTs = [...buckets.keys()].sort();
  const wideRows = sortedTs.map((ts) => buckets.get(ts)!);
  // Stable, alphabetical category order so the stack layering is
  // deterministic across renders.
  const series = [...categories]
    .sort()
    .map((cat) => ({ dataKey: cat, label: cat }));
  return { rows: wideRows, series };
}

/** Cap title length so the chart header doesn't wrap to 3+ lines. */
function clampTitle(s: string, max = 64): string {
  if (s.length <= max) return s;
  // Try to cut at the last space before the limit for cleaner wrap.
  const cut = s.slice(0, max).lastIndexOf(" ");
  return (cut > max * 0.6 ? s.slice(0, cut) : s.slice(0, max)).trim() + "…";
}

/**
 * Refine a chart title by combining the user's question (semantic intent)
 * with the actual data shape (ground truth). Idempotent — applying twice
 * yields the same result, so explicit hand-crafted titles like
 * "Top holdings by USD value" pass through unchanged.
 *
 * Pipeline:
 *   1. Strip leading filler verbs ("Show me ...", "What is ...", etc.)
 *      that read as noise in a chart title.
 *   2. Strip trailing punctuation (?/!/.).
 *   3. Sentence-case (uppercase first letter only) — preserves proper
 *      nouns like RLUSD, USD, NFT.
 *   4. Reconcile "Top N" claims with actual row count: if the question
 *      said "Top 10" but the AI returned 7 rows, rewrite to "Top 7".
 *   5. Strip a couple specific redundancies ("trading volume" → "volume").
 *   6. Cap at 64 chars (clampTitle does the smart cut).
 *
 * If the cleaned hint is empty, single-word, or too generic, returns
 * null and the caller falls back to a canonical title built from data
 * shape ("Volume by token", "DEX activity over time", etc.).
 */
function refineTitle(hint: string | undefined, actualRowCount: number): string | null {
  if (!hint) return null;
  let s = hint.trim();
  if (!s) return null;

  // Strip trailing punctuation.
  s = s.replace(/[?.!]+$/u, "");

  // Strip leading filler verbs that don't belong in a chart title.
  // Order matters — match the longer "what is the" before "what is".
  s = s.replace(
    /^(?:show me|tell me|give me|list me|list|how many|how much|what(?:'s| is| are)(?: the)?|which(?:\sare)?)\s+/iu,
    "",
  );
  // Strip a leading article that survived the verb cleanup
  // ("Show me the daily ..." → "the daily ..." → "daily ...").
  s = s.replace(/^(?:the|a|an)\s+/iu, "").trim();
  if (!s) return null;

  // Reconcile "Top N" with the actual row count returned by the query.
  // The AI sometimes LIMITs differently than the user asked for, or the
  // dataset legitimately has fewer rows than requested.
  s = s.replace(/\btop\s+(\d+)\b/iu, (_m, n) => {
    const claimed = Number.parseInt(String(n), 10);
    return Number.isFinite(claimed) && claimed !== actualRowCount
      ? `Top ${actualRowCount}`
      : `Top ${claimed}`;
  });

  // Drop "trading " before "volume" — common AI verbosity that adds nothing.
  s = s.replace(/\btrading volume\b/giu, "volume");

  // Sentence case: capitalize first letter, leave everything else.
  // This preserves proper nouns / tickers (RLUSD, USD, NFT, AMM).
  s = s.charAt(0).toLocaleUpperCase() + s.slice(1);

  // If after cleaning we have nothing meaningful (single word, < 3 chars),
  // signal the caller to fall back to canonical.
  if (s.length < 3 || !/\s/.test(s)) return null;

  return clampTitle(s, 64);
}

/** Build a canonical title from chart shape when the user question
 *  produced no usable hint. */
function canonicalTitle(opts: {
  isTimeSeries: boolean;
  isStacked: boolean;
  primaryLabel: string;
  categoryLabel?: string;
  rowCount: number;
}): string {
  if (opts.isStacked && opts.categoryLabel) {
    return clampTitle(`${opts.primaryLabel} share by ${opts.categoryLabel} over time`, 64);
  }
  if (opts.isTimeSeries) {
    return clampTitle(`${opts.primaryLabel} over time`, 64);
  }
  if (opts.categoryLabel) {
    // For top-N categorical, prefix the actual N so the chart is self-describing.
    const prefix = opts.rowCount >= 5 && opts.rowCount <= 50 ? `Top ${opts.rowCount} ` : "";
    const suffix = `${opts.primaryLabel} by ${opts.categoryLabel}`;
    return clampTitle(`${prefix}${suffix}`.trim(), 64);
  }
  return clampTitle(opts.primaryLabel, 64);
}

/** Drop numeric columns whose values are flat (all-zero, or every row has
 *  the same value) when at least one other numeric column has variance.
 *
 *  Why: AI-generated SELECTs sometimes include columns that come back
 *  trivially constant on a given dataset (e.g. `memo` mostly null with a
 *  few 0s, or a status flag that's the same for every row in the window).
 *  Plotting them adds a dead horizontal line that crowds the legend and
 *  makes the chart read worse. We never strip the last numeric column —
 *  the all-flat case still falls through to `isFlatLine` below, which
 *  routes the result to a stat/table render instead of a chart. */
function pruneFlatNumericCols(rows: Row[], cls: Classification): Classification {
  if (cls.numericCols.length <= 1) return cls;

  const survivors = cls.numericCols.filter((col) => {
    let min = Infinity;
    let max = -Infinity;
    let count = 0;
    for (const r of rows) {
      const v = toNumber(r[col.key]);
      if (v == null) continue;
      count++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (count === 0) return false;
    // Keep columns with any spread, or constant non-zero values
    // (a constant non-zero might still be intentional context).
    if (min === max && min === 0) return false;
    if (min === max) return false; // pure horizontal line
    return true;
  });

  // Bail if pruning would leave us with nothing — let downstream
  // checks (isAllZero / isFlatLine) handle the all-dead case.
  if (survivors.length === 0) return cls;
  return { ...cls, numericCols: survivors };
}

/** Two numeric columns are "approximately equal" when every row's pair of
 *  values agrees within `tolerance` (relative). Used to detect series
 *  that paint on top of each other in a chart — e.g. XRPL `Amount` and
 *  `DeliveredAmount` are identical except on partial payments. */
function columnsApproxEqual(
  rows: Row[],
  aKey: string,
  bKey: string,
  tolerance = 0.005,
): boolean {
  let overlap = 0;
  for (const r of rows) {
    const a = toNumber(r[aKey]);
    const b = toNumber(r[bKey]);
    if (a == null && b == null) continue;
    if (a == null || b == null) return false;
    overlap++;
    const denom = Math.max(Math.abs(a), Math.abs(b), 1);
    if (Math.abs(a - b) / denom > tolerance) return false;
  }
  // Require enough overlapping points to claim equality — two rows could
  // coincidentally match by chance, but a consistent match across many is
  // a real signal.
  return overlap >= 3;
}

/** Drop later numeric columns that are approximately equal to an earlier
 *  one. The first column in declaration order wins — keeps "Amount" and
 *  drops "Delivered" rather than the other way around, which usually
 *  matches the question's primary metric. */
function dedupeNumericCols(rows: Row[], cls: Classification): Classification {
  const out: NumericCol[] = [];
  for (const col of cls.numericCols) {
    const dup = out.some((kept) => columnsApproxEqual(rows, kept.key, col.key));
    if (!dup) out.push(col);
  }
  if (out.length === cls.numericCols.length) return cls;
  return { ...cls, numericCols: out };
}

/** All-zero detector — every numeric value across rows is 0/null/NaN.
 *  Charts of all-zero data look broken; fall through to other renderers. */
function isAllZero(rows: Row[], cls: Classification): boolean {
  for (const nc of cls.numericCols) {
    for (const r of rows) {
      const v = toNumber(r[nc.key]);
      if (v !== null && v !== 0) return false;
    }
  }
  return true;
}

/** Single-distinct-value detector — every row has the same numeric values.
 *  A "chart" of constant data is meaningless; fall through. */
function isFlatLine(rows: Row[], cls: Classification): boolean {
  for (const nc of cls.numericCols) {
    const seen = new Set<number>();
    for (const r of rows) {
      const v = toNumber(r[nc.key]);
      if (v != null) seen.add(v);
      if (seen.size > 1) return false;
    }
  }
  return true;
}

/**
 * Inspect the row shape and return a chart config, or null if no good fit.
 * Rules:
 *   - 2–200 rows required.
 *   - all-zero or single-distinct-value data → null (use table/stat instead)
 *   - timestamp + 1 categorical + 1 numeric (long-format) → pivot to wide,
 *     then render as stacked area when preferredShape="stacked-area" /
 *     was "pie" + has timestamp, otherwise multi-series line
 *   - timestamp + 1 numeric         → area chart
 *   - timestamp + 2–4 numeric       → line chart (multi-series)
 *   - 1 category + 1–3 numeric,     → bar chart (default for ≤ 50 rows)
 *   - 1 category + 1 numeric        → pie chart (only when preferredShape="pie" AND ≤ 8 rows)
 *   - otherwise → null
 */
export function buildChartFromRows(rows: Row[], opts: BuildChartOptions = {}): Visualization | null {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 200) return null;

  let cls = classifyColumns(rows);
  if (cls.numericCols.length === 0) return null;
  // Drop dead-flat columns (e.g. `memo` returning all 0s) before dedupe so
  // they don't get treated as a "duplicate" of a real series via the
  // 0-vs-0 case slipping through.
  cls = pruneFlatNumericCols(rows, cls);
  // Then collapse near-identical numeric columns (e.g. Amount XRP vs
  // Delivered XRP on non-partial payments paint on top of each other).
  cls = dedupeNumericCols(rows, cls);
  if (isAllZero(rows, cls)) return null;
  if (isFlatLine(rows, cls)) return null;

  const normalized = normalizeRows(rows, cls);

  // Time-series — first try the long-format pivot for share-over-time
  // shapes. Triggers when the AI returns one row per (timestamp × category)
  // with a single numeric metric. This is the natural SQL output for
  // questions like "Share of XRP volume by token over the past 30 days":
  //   GROUP BY day, base_currency
  // Without the pivot we'd plot every row as one series and get a noisy
  // mess; with it, each category becomes its own stacked layer.
  if (cls.timestampCols.length >= 1) {
    const tsCol = cls.timestampCols[0];

    // Long-format pivot opportunity:
    //   exactly 1 numeric col + exactly 1 categorical col.
    // Auto-promote share intent ("pie" + timestamp) to stacked-area since
    // "share at a point" + "over time" → "share over time".
    const wantsStacked =
      opts.preferredShape === "stacked-area" ||
      (opts.preferredShape === "pie" && cls.timestampCols.length >= 1);
    if (cls.numericCols.length === 1 && cls.categoryCols.length === 1) {
      const valueCol = cls.numericCols[0];
      const catCol = cls.categoryCols[0];
      const pivoted = pivotLongToWide(normalized, tsCol.key, catCol.key, valueCol.key);
      if (pivoted) {
        // Sort wide rows by timestamp ascending (already done in pivot but
        // re-sort defensively).
        const sorted = [...pivoted.rows].sort((a, b) => {
          const ta = new Date(String(a[tsCol.key])).getTime();
          const tb = new Date(String(b[tsCol.key])).getTime();
          return ta - tb;
        });
        const refined = refineTitle(opts.titleHint, sorted.length);
        const fallback = canonicalTitle({
          isTimeSeries: true,
          isStacked: wantsStacked,
          primaryLabel: seriesLabel(valueCol),
          categoryLabel: catCol.label,
          rowCount: sorted.length,
        });
        // Stacked → area (with stackId) so the layered totals read as a
        // share-of-whole. Unstacked → multi-line (clearer for raw trends
        // per category, since overlapping unstacked areas look muddled).
        return {
          type: wantsStacked ? "area" : "line",
          title: refined ?? fallback,
          data: sorted,
          series: pivoted.series,
          xAxis: { dataKey: tsCol.key, label: tsCol.label, type: "category" },
          yAxis: { label: seriesLabel(valueCol) },
          stacked: wantsStacked || undefined,
        };
      }
    }

    // Wide-format time-series (1+ numeric cols, no pivot needed).
    const yCols = cls.numericCols.slice(0, 4);
    const sorted = [...normalized].sort((a, b) => {
      const ta = new Date(String(a[tsCol.key])).getTime();
      const tb = new Date(String(b[tsCol.key])).getTime();
      return ta - tb;
    });
    const type: Visualization["type"] = yCols.length === 1 ? "area" : "line";
    const refined = refineTitle(opts.titleHint, sorted.length);
    const fallback = canonicalTitle({
      isTimeSeries: true,
      isStacked: false,
      primaryLabel: yCols.length === 1 ? seriesLabel(yCols[0]) : "Value",
      rowCount: sorted.length,
    });
    return {
      type,
      title: refined ?? fallback,
      data: sorted,
      series: yCols.map((y) => ({ dataKey: y.key, label: seriesLabel(y) })),
      xAxis: { dataKey: tsCol.key, label: tsCol.label, type: "category" },
      yAxis: { label: yCols.length === 1 ? seriesLabel(yCols[0]) : "Value" },
    };
  }

  // Categorical
  const catCol = pickCategoryCol(cls, rows.length, rows);
  if (!catCol) return null;

  // Pie: only when explicitly requested AND the shape makes sense
  if (opts.preferredShape === "pie" && cls.numericCols.length === 1 && rows.length <= 8) {
    const yCol = cls.numericCols[0];
    const refined = refineTitle(opts.titleHint, rows.length);
    const fallback = canonicalTitle({
      isTimeSeries: false,
      isStacked: false,
      primaryLabel: seriesLabel(yCol),
      categoryLabel: catCol.label,
      rowCount: rows.length,
    });
    return {
      type: "pie",
      title: refined ?? fallback,
      data: normalized,
      series: [{ dataKey: yCol.key, label: seriesLabel(yCol) }],
      xAxis: { dataKey: catCol.key, label: catCol.label, type: "category" },
      yAxis: { label: seriesLabel(yCol) },
    };
  }

  // Bar: up to 3 numeric series, ≤ 50 rows. Bumped from 30 → 50 since
  // we render a horizontal bar/table hybrid (see HorizontalBarTable in
  // ChartRenderer) which scales well to longer lists.
  //
  // No scale-mismatch filter here: secondary numerics render as plain
  // right-aligned columns (not competing bars), so a "Trade Count = 200
  // next to Volume = 10M" pairing displays cleanly — Volume gets the
  // bar, Trades is a plain side metric. The filter was holdover from
  // when this branch produced vertical Recharts multi-bar charts.
  if (rows.length <= 50) {
    const yCols = cls.numericCols.slice(0, 3);
    const refined = refineTitle(opts.titleHint, rows.length);
    const fallback = canonicalTitle({
      isTimeSeries: false,
      isStacked: false,
      primaryLabel: yCols[0] ? seriesLabel(yCols[0]) : "Value",
      categoryLabel: catCol.label,
      rowCount: rows.length,
    });
    return {
      type: "bar",
      title: refined ?? fallback,
      data: normalized,
      series: yCols.map((y) => ({ dataKey: y.key, label: seriesLabel(y) })),
      xAxis: { dataKey: catCol.key, label: catCol.label, type: "category" },
      yAxis: { label: yCols.length === 1 ? seriesLabel(yCols[0]) : "Value" },
    };
  }

  return null;
}

function seriesLabel(col: NumericCol): string {
  if (col.kind === "drops") {
    // "Fee Drops" → "Fee (XRP)", "Amount Drops" → "Amount (XRP)"
    return col.label.replace(/\s*Drops?$/i, "").trim() + " (XRP)";
  }
  return col.label;
}

/**
 * For investigate-style flows where tool results are JSON strings each
 * containing `{ rows: [...] }` or an array directly. Picks the largest
 * sensibly-chartable result and runs the shape detector on it.
 */
export function buildChartFromToolCalls(
  toolCalls: Array<{ name: string; input: unknown; result: string }>,
  opts: BuildChartOptions = {},
): Visualization | null {
  let best: Row[] | null = null;
  let bestScore = -1;

  for (const tc of toolCalls) {
    const candidates = extractRowCandidates(tc.result);
    for (const rows of candidates) {
      if (rows.length < 2 || rows.length > 200) continue;
      const cols = Object.keys(rows[0] ?? {});
      if (cols.length === 0) continue;
      const score = Math.min(rows.length, 100) + cols.length;
      if (score > bestScore) {
        bestScore = score;
        best = rows;
      }
    }
  }

  if (!best) return null;
  return buildChartFromRows(best, opts);
}

function extractRowCandidates(resultJson: string): Row[][] {
  try {
    const parsed = JSON.parse(resultJson);
    const out: Row[][] = [];
    if (Array.isArray(parsed?.rows)) out.push(parsed.rows as Row[]);
    if (Array.isArray(parsed?.paths)) out.push(parsed.paths as Row[]);
    if (Array.isArray(parsed)) out.push(parsed as Row[]);
    return out;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Stat + Table shape detection                                       */
/* ------------------------------------------------------------------ */

/**
 * Detect a single-value answer (1 row × 1 column where the value is
 * numeric or numeric-coerceable). Used as a fallback when the result
 * isn't chartable but is a clear scalar.
 *
 * Examples it catches:
 *   SELECT count(*) FROM transactions WHERE …  → { count: 12450 }
 *   SELECT max(close_time) FROM ledgers        → { max: "2026-05-03 …" }
 */
export function detectStatValue(rows: Row[]): StatValue | null {
  if (rows.length !== 1) return null;
  const row = rows[0];
  const keys = Object.keys(row);
  if (keys.length !== 1) return null;

  const key = keys[0];
  const raw = row[key];

  // Numeric (or coerceable from string)
  const num = toNumber(raw);
  if (num !== null) {
    return {
      label: toLabel(key),
      value: num,
      format: DROPS_COL_RE.test(key) ? "drops" : "number",
    };
  }

  // String value (e.g. a hash, address, or ISO timestamp). Render raw.
  if (typeof raw === "string" && raw.length > 0 && raw.length < 100) {
    return { label: toLabel(key), value: raw, format: "raw" };
  }

  return null;
}

/**
 * Detect tabular shape for results that aren't chartable. Capped at
 * 100 rows for client render practicality — the SQL itself was already
 * LIMIT 100 by routeQuery, so this just respects that ceiling.
 *
 * Skips when:
 *   - Single row (handled by detectStatValue)
 *   - No columns at all
 *   - Excessively wide (>16 columns — probably a leaked SELECT *)
 */
export function detectTableData(rows: Row[]): TableData | null {
  if (rows.length < 2) return null;
  if (rows.length > 100) return null;

  const firstRow = rows[0];
  const keys = Object.keys(firstRow);
  if (keys.length === 0 || keys.length > 16) return null;

  return {
    columns: keys.map((k) => ({ key: k, label: toLabel(k) })),
    rows: rows as Row[],
    total: rows.length,
  };
}
