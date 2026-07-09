"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from "motion/react";

const STATION_COUNT = 7;

/**
 * SubwayLine — scroll-driven straight vertical line + station dots.
 *
 * Uses ResizeObserver to set the SVG viewBox to the exact inner container
 * dimensions so rendering is 1:1 with no distortion. The ref is on the
 * max-w-6xl div so measured width matches the SVG's rendered width.
 *
 * Desktop only — hidden on mobile.
 */
export function SubwayLine() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  const pathLength = useTransform(scrollYProgress, [0, 0.95], [0, 1]);

  const stationThresholds = Array.from(
    { length: STATION_COUNT },
    (_, i) => (i + 0.5) / STATION_COUNT
  );

  // Measure the inner container so viewBox matches 1:1 with rendered pixels
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setDims({ w: Math.round(width), h: Math.round(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!dims)
    return (
      <div
        className="pointer-events-none absolute inset-0 hidden lg:block"
        aria-hidden="true"
      >
        <div ref={ref} className="mx-auto h-full max-w-6xl" />
      </div>
    );

  const cx = dims.w / 2;
  const segH = dims.h / STATION_COUNT;
  const pathD = `M ${cx} 0 L ${cx} ${dims.h}`;

  return (
    <div
      className="pointer-events-none absolute inset-0 hidden lg:block"
      aria-hidden="true"
    >
      <div ref={ref} className="relative mx-auto h-full max-w-6xl">
        {/* SVG layer — the animated line */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          fill="none"
        >
          {/* Background track */}
          <path
            d={pathD}
            stroke="var(--color-border)"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.25"
          />

          {/* Animated foreground line */}
          {!reduced ? (
            <motion.path
              d={pathD}
              stroke="var(--color-brand)"
              strokeWidth="3"
              strokeLinecap="round"
              style={{ pathLength }}
            />
          ) : (
            <path
              d={pathD}
              stroke="var(--color-brand)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* HTML layer — station dots */}
        {stationThresholds.map((threshold, i) => (
          <StationDot
            key={i}
            segH={segH}
            containerW={dims.w}
            scrollProgress={scrollYProgress}
            threshold={threshold}
            reduced={reduced}
          />
        ))}
      </div>
    </div>
  );
}

/** Station dot — HTML-based so it stays perfectly round. */
function StationDot({
  segH,
  containerW,
  scrollProgress,
  threshold,
  reduced,
}: {
  segH: number;
  containerW: number;
  scrollProgress: MotionValue<number>;
  threshold: number;
  reduced: boolean | null;
}) {
  const topPx = Math.round(threshold * STATION_COUNT * segH);
  const leftPx = containerW / 2;

  const ringOpacity = useTransform(
    scrollProgress,
    [threshold - 0.05, threshold + 0.05],
    [0, 1]
  );

  const ringScale = useTransform(
    scrollProgress,
    [threshold - 0.05, threshold, threshold + 0.05],
    [0.5, 1.2, 1]
  );

  const dotBg = useTransform(
    scrollProgress,
    [threshold - 0.05, threshold + 0.05],
    ["var(--color-border)", "var(--color-brand)"]
  );

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ top: topPx, left: leftPx }}
    >
      {/* Outer ring */}
      {!reduced ? (
        <motion.div
          className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-brand"
          style={{ opacity: ringOpacity, scale: ringScale }}
        />
      ) : (
        <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-brand" />
      )}

      {/* Inner dot */}
      {!reduced ? (
        <motion.div
          className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ backgroundColor: dotBg }}
        />
      ) : (
        <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand" />
      )}
    </div>
  );
}

export default SubwayLine;
