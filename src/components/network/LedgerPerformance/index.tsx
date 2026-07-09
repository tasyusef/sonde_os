"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useLiveData } from "@/hooks/useLiveData";
import Watermark from "@/components/shared/Watermark";
import type { LedgerEvent } from "@/types/live-data";

interface DataPoint {
  index: number;
  tps: number;
  closeTime: number;
  txns: number;
}

/** Heatmap dimensions per breakpoint.
 *
 *  Desktop: 40 columns × 5 rows = 200 cells (~16.7 minutes of XRPL history).
 *  Mobile:  16 columns × 5 rows =  80 cells (~ 6.7 minutes).
 *
 *  Why fewer cells on mobile rather than just smaller cells: at 40 cols
 *  on a 375px-wide phone, each cell is ~8px wide — too small to tap, and
 *  the "heatmap" pattern stops reading as a heatmap. 16 cols / 80 cells
 *  gives ~20px cells that are tappable AND preserve the visual rhythm.
 *  Stats (current/avg/close-time) are computed from whichever window is
 *  currently displayed, so the "Last N ledgers" label is honest. */
const LAYOUT_MOBILE = { cells: 80, cols: 16 };
const LAYOUT_DESKTOP = { cells: 200, cols: 40 };
const MOBILE_BREAKPOINT_QUERY = "(min-width: 640px)"; // Tailwind sm
/** Largest possible cell count — used to size the merge buffer so we never
 *  fetch less than what the widest layout could display. */
const MAX_CELLS = LAYOUT_DESKTOP.cells;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Quartile-based intensity bucketing — same approach GitHub uses on
 *  contribution graphs. Compared to max-ratio bucketing (`tps / maxTps`),
 *  this guarantees a visible gradient even when the data is right-skewed
 *  (a handful of outliers + many low-activity ledgers). The thresholds
 *  are computed once per render from the full non-zero distribution and
 *  passed into `intensityClass`. Cells with zero TPS always fall in the
 *  empty bucket so a literally-empty ledger reads as "no activity" rather
 *  than "lowest of the active ones." */
type IntensityThresholds = [number, number, number, number];

function computeThresholds(tpsValues: number[]): IntensityThresholds {
  const nonZero = tpsValues.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [0, 0, 0, 0];
  // Pick the value at each quartile boundary (using floor so ties land
  // in the lower bucket — matches GitHub's behavior).
  const at = (q: number) =>
    nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * q))];
  return [at(0.25), at(0.5), at(0.75), at(1)];
}

function intensityClass(tps: number, t: IntensityThresholds): string {
  if (tps <= 0) return "bg-brand/[0.06]";
  if (tps <= t[0]) return "bg-brand/[0.15]";
  if (tps <= t[1]) return "bg-brand/[0.30]";
  if (tps <= t[2]) return "bg-brand/[0.55]";
  return "bg-brand/[0.85]";
}

function closeTimeColor(seconds: number): string {
  if (seconds <= 5) return "text-success";
  if (seconds <= 10) return "text-warning";
  return "text-error";
}

/** Merge DB-seeded ledgers with live SSE ledgers, dedup by index, keep last 101 */
function mergeLedgers(
  dbLedgers: LedgerEvent[],
  sseLedgers: LedgerEvent[],
): LedgerEvent[] {
  const map = new Map<number, LedgerEvent>();
  for (const l of dbLedgers) map.set(l.ledger_index, l);
  for (const l of sseLedgers) map.set(l.ledger_index, l);
  return [...map.values()]
    .sort((a, b) => a.ledger_index - b.ledger_index)
    .slice(-(MAX_CELLS + 1)); // 201 raw ledgers = 200 intervals
}

export default function LedgerPerformance() {
  const { ledgerHistory, connected } = useLiveData();
  const { data: dbLedgers } = useSWR<LedgerEvent[]>(
    "/api/ledger-history",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Track viewport so we can swap layouts on resize. Default to desktop
  // for SSR — first client render flips to mobile via the effect below
  // if the screen is narrow. The brief desktop-first paint is fine: it's
  // only one frame and the heatmap is already loading data anyway.
  const [layout, setLayout] = useState(LAYOUT_DESKTOP);
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const update = () => setLayout(mql.matches ? LAYOUT_DESKTOP : LAYOUT_MOBILE);
    update();
    // Use the modern API; older Safari fallback is via addListener.
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const merged = useMemo(
    () => mergeLedgers(dbLedgers ?? [], ledgerHistory),
    [dbLedgers, ledgerHistory],
  );

  const { dataPoints, avgTps, lastCloseTime, lastTps, thresholds } = useMemo(() => {
    const pts: DataPoint[] = [];
    for (let i = 1; i < merged.length; i++) {
      const prev = merged[i - 1];
      const curr = merged[i];
      const closeTime = curr.ledger_time - prev.ledger_time;
      const tps = closeTime > 0 ? curr.txn_count / closeTime : 0;
      pts.push({
        index: curr.ledger_index,
        tps: Math.round(tps * 10) / 10,
        closeTime,
        txns: curr.txn_count,
      });
    }
    // Keep only the last layout.cells data points (responsive)
    const sliced = pts.slice(-layout.cells);
    const n = sliced.length;
    return {
      dataPoints: sliced,
      // Average TPS still rolls over the displayed window — that's
      // useful for "is the network running busy on average."
      avgTps: n > 0 ? sliced.reduce((s, d) => s + d.tps, 0) / n : 0,
      // Ledger Close shows the LAST ledger's actual close time, not a
      // window-averaged value. Averaging over 200 ledgers buries new
      // ledgers' contributions (each new sample shifts the mean by
      // ~0.5%, imperceptible) and the displayed number feels stuck.
      // Last-close is what "Current" tx/s already shows for TPS;
      // matching the pattern keeps both top stats live-updating.
      lastCloseTime: n > 0 ? sliced[n - 1].closeTime : 0,
      lastTps: n > 0 ? sliced[n - 1].tps : 0,
      thresholds: computeThresholds(sliced.map((d) => d.tps)),
    };
  }, [merged, layout.cells]);

  const hasData = dataPoints.length >= 2;
  const hovered = hoveredIdx !== null ? dataPoints[hoveredIdx] : null;

  const handlePointerEnter = useCallback((i: number) => setHoveredIdx(i), []);
  const handlePointerLeave = useCallback(() => setHoveredIdx(null), []);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      {/* Header */}
      <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${connected ? "animate-pulse bg-success" : "bg-error"}`}
          />
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            Live Ledger Performance
          </span>
        </div>
        <span className="font-mono text-tag text-muted">
          Last {dataPoints.length} ledgers
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 border-b border-elevated px-4 py-3">
        <Metric
          label="Current"
          value={hasData ? `${lastTps.toFixed(1)}` : "—"}
          unit={hasData ? "tx/s" : undefined}
        />
        <Metric
          label="Average"
          value={hasData ? `${avgTps.toFixed(1)}` : "—"}
          unit={hasData ? "tx/s" : undefined}
        />
        <Metric
          label="Ledger Close"
          value={hasData ? `${lastCloseTime.toFixed(1)}` : "—"}
          unit={hasData ? "sec" : undefined}
          valueColor={hasData ? closeTimeColor(lastCloseTime) : undefined}
        />
      </div>

      {/* Heatmap grid */}
      <div
        className="relative flex-1 px-4 py-4"
        role="img"
        aria-label="Transactions per second heatmap for recent ledgers"
      >
        {/* Watermark */}
        <Watermark />

        {!hasData ? (
          <div className="flex h-full min-h-[200px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              Collecting ledger data...
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Tooltip bar — fixed height to prevent layout shift */}
            <div className="h-5">
              {hovered ? (
                <p className="font-mono text-cell text-muted">
                  <span className="text-primary font-medium">
                    #{hovered.index.toLocaleString()}
                  </span>
                  {" — "}
                  {hovered.tps.toFixed(1)} tx/s · {hovered.closeTime.toFixed(1)}s
                  {" · "}
                  {hovered.txns} txns
                </p>
              ) : (
                <p className="font-mono text-cell text-muted/50">
                  Hover a cell for details
                </p>
              )}
            </div>

            {/* Grid — responsive: 16 cols × 5 rows on mobile (80 cells),
                40 cols × 5 rows at sm+ (200 cells). Cells scale to fill
                the container width.

                GitHub-contribution-graph layout: column-major flow with 5
                explicit rows. Data array is ascending (oldest → newest),
                so cell 0 lands at row 1, col 1 (top-left, oldest), each
                column fills top-to-bottom, columns flow left-to-right,
                cell N-1 (newest) lands at row 5, last col (bottom-right).
                Reading right column = newest time slice; bottom of any
                column = newest within that slice. */}
            <div
              ref={gridRef}
              className="grid gap-[var(--grid-gap-tight)]"
              style={{
                gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
                gridTemplateRows: "repeat(5, 1fr)",
                gridAutoFlow: "column",
              }}
            >
              {/* Empty cells to right-align partial grid */}
              {dataPoints.length < layout.cells &&
                Array.from(
                  { length: layout.cells - dataPoints.length },
                  (_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="aspect-square rounded-md bg-elevated/30"
                    />
                  ),
                )}
              {/* Cells keyed by grid position (not ledger_index) so React
                  reuses each DOM node across data shifts. When a new ledger
                  arrives, the dataPoints array slides — the cell at position
                  i now renders what was at position i+1, which means its
                  background color changes. The transition+delay below makes
                  each cell's color change ripple out from the newest cell
                  toward the oldest, so the data "snakes" through the grid
                  bottom-right → up the rightmost col → bottom of col-1 →
                  up that col → ... matching column-major flow. */}
              {dataPoints.map((d, i) => {
                // Wave starts at the newest cell (delay 0), progressively
                // delays older cells. 12ms step × 200 cells = 2.4s total
                // wave time on desktop, well within the typical 4s ledger
                // close interval — slightly more deliberate read than 8ms,
                // which felt rushed.
                const cellsFromNewest = dataPoints.length - 1 - i;
                const delayMs = cellsFromNewest * 12;
                return (
                  <div
                    key={i}
                    className={`aspect-square rounded-md ${intensityClass(d.tps, thresholds)} ${
                      hoveredIdx !== null && hoveredIdx !== i
                        ? "opacity-50"
                        : "opacity-100"
                    }`}
                    style={{
                      transitionProperty: "background-color, opacity",
                      transitionDuration: "350ms, 150ms",
                      transitionTimingFunction: "ease-out, ease-out",
                      // Hover-dim opacity is instant per cell (no stagger);
                      // bg color uses the staggered wave delay.
                      transitionDelay: `${delayMs}ms, 0ms`,
                    }}
                    onPointerEnter={() => handlePointerEnter(i)}
                    onPointerLeave={handlePointerLeave}
                  />
                );
              })}
            </div>

            {/* Bottom metadata strip — one row, three flex clusters:
                time direction (←/→) at the edges frames the intensity
                legend in the middle. Uppercase + tracking-pill matches
                the rest of the design system's label treatment (same
                shape as TX type tags, status badges, etc.) so the
                strip reads as coherent metadata, not utility text. */}
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 font-mono text-tag font-medium uppercase tracking-pill text-muted">
                <span aria-hidden="true" className="text-brand/70">←</span>
                Oldest
              </span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-tag font-medium uppercase tracking-pill text-muted mr-1">
                  Less
                </span>
                <div className="h-[8px] w-[8px] rounded-swatch bg-brand/[0.06]" />
                <div className="h-[8px] w-[8px] rounded-swatch bg-brand/[0.15]" />
                <div className="h-[8px] w-[8px] rounded-swatch bg-brand/[0.30]" />
                <div className="h-[8px] w-[8px] rounded-swatch bg-brand/[0.55]" />
                <div className="h-[8px] w-[8px] rounded-swatch bg-brand/[0.85]" />
                <span className="font-mono text-tag font-medium uppercase tracking-pill text-muted ml-1">
                  More
                </span>
              </div>
              <span className="flex items-center gap-1.5 font-mono text-tag font-medium uppercase tracking-pill text-muted">
                Newest
                <span aria-hidden="true" className="text-brand/70">→</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  valueColor,
}: {
  label: string;
  value: string;
  unit?: string;
  valueColor?: string;
}) {
  return (
    <div>
      <p className="font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span
          className={`font-mono text-value font-medium tabular-nums ${valueColor ?? "text-primary"}`}
        >
          {value}
        </span>
        {unit && (
          <span className="font-mono text-label text-muted">{unit}</span>
        )}
      </p>
    </div>
  );
}
