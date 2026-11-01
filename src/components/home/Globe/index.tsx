import { useEffect, useRef, type RefObject } from "react";
import { useTheme } from "@/hooks/useTheme";
import {
  ACCENT,
  decodeRuns,
  discRadius,
  globeFrame,
  globeView,
  INK,
  type GlobeView,
} from "@/lib/globe";
import { drawArcs, liveArcs } from "@/lib/globe-arcs";
import { useHydratedReducedMotion } from "@/lib/motion-client";
import { cn } from "@/lib/utils";
import { LAND_RUNS } from "./land";
import { cellPainter, packed } from "./paint";

const SEED = 7;

/** CSS pixels per dither cell. */
const PX = 2;

let land: Uint8Array | null = null;

interface GlobeProps {
  /** What runs across the globe's middle (the search): it keeps a
   *  clearing round it. */
  clearRef: RefObject<HTMLElement | null>;
  /** Places the canvas (`absolute inset-0` by default); the globe
   *  centres in it. */
  className?: string;
}

/**
 * The home page's ground: a dithered Earth, lit from the upper left,
 * turning slowly, with arcs of light running between places on it
 * (`lib/globe-arcs`). Land, sea and halo draw in the ink, arcs in the
 * accent.
 *
 * Draws every animation frame, only while on screen and the tab is
 * visible. Reduced motion draws one still frame.
 */
export default function Globe({ clearRef, className }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // When its clock started, kept across theme changes so it doesn't jump.
  const epoch = useRef(0);
  const { isDark } = useTheme();
  const reduced = useHydratedReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    land ??= decodeRuns(LAND_RUNS);
    const mask = land;
    const css = getComputedStyle(canvas);
    const colors: number[] = [];
    colors[INK] = packed(css.getPropertyValue("--color-rim-strong").trim());
    colors[ACCENT] = packed(css.getPropertyValue("--color-brand").trim());
    const painter = cellPainter(canvas, colors);
    let view: GlobeView | null = null;
    let frame = new Uint8Array(0);
    let t = 0;

    const layout = () => {
      const dpr = window.devicePixelRatio || 1;
      const unit = Math.max(1, Math.round(PX * dpr));
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.round(box.width * dpr);
      canvas.height = Math.round(box.height * dpr);
      const cols = Math.ceil(canvas.width / unit);
      const rows = Math.ceil(canvas.height / unit);
      // Not laid out yet (or hidden): nothing to draw on.
      view = null;
      if (!cols || !rows) return;
      const search = clearRef.current?.getBoundingClientRect();
      const toCell = (px: number) => Math.floor((px * dpr) / unit);
      const clear = search && {
        x0: toCell(search.left - box.left),
        y0: toCell(search.top - box.top),
        x1: toCell(search.right - box.left),
        y1: toCell(search.bottom - box.top),
      };
      view = globeView(cols, rows, cols / 2, rows / 2, discRadius(cols, rows), clear ?? null);
      frame = new Uint8Array(cols * rows);
      painter.resize(cols, rows, unit);
    };

    const draw = () => {
      if (!view) return;
      globeFrame(frame, view, mask, t);
      drawArcs(frame, view, liveArcs(t, mask, SEED), t);
      painter.paint(frame);
    };

    // `t` keeps counting while paused, so the turn picks up where the
    // time is, not where it stopped.
    epoch.current ||= performance.now();
    let raf = 0;
    const loop = (now: number) => {
      t = (now - epoch.current) / 1000;
      draw();
      raf = requestAnimationFrame(loop);
    };
    let onScreen = false;
    const run = () => {
      cancelAnimationFrame(raf);
      if (!reduced && onScreen && !document.hidden) raf = requestAnimationFrame(loop);
    };

    const resize = new ResizeObserver(() => {
      layout();
      draw();
    });
    resize.observe(canvas);
    // The search grows when it shows an error; the clearing grows with it.
    if (clearRef.current) resize.observe(clearRef.current);
    const seen = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      run();
    });
    seen.observe(canvas);
    document.addEventListener("visibilitychange", run);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", run);
    };
  }, [clearRef, isDark, reduced]);

  return (
    <div aria-hidden="true" className={cn("pointer-events-none", className ?? "absolute inset-0")}>
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
