"use client";

import { useEffect } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { LineChart, Sparkles } from "lucide-react";
import { HeroGrid } from "@/components/landing/HeroGrid";
import { FloatingShapes } from "@/components/landing/FloatingShapes";
import { NetworkCanvas } from "@/components/landing/NetworkCanvas";
import AnomalyFeed from "@/components/network/AnomalyFeed";
import { buttonClasses } from "@/components/shared/Button";
import { HOVER_SCALE, SPRING, TAP_SCALE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/* Compact integer formatter — same shape as `formatVolume` but
 * without the leading `$`. Use for non-currency counts (active
 * wallets, trust lines, transaction count) where the value is
 * raw quantity, not money. Also fine for XRP counts — the unit
 * gets clarified by the stat label. */
function formatCount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/* ——— Change pill ———
 * Mirrors the `ChangeBadge` in `NetworkGrowthStats`. Green for ≥0,
 * red for <0, hidden when `change` is `null` (insufficient prior data
 * to compute a meaningful delta — e.g. first 7d of a brand-new
 * metric). Compact size so it fits beside `text-cell` stat values. */
function ChangePill({ change }: { change: number | null }) {
  if (change == null || !Number.isFinite(change)) return null;
  const isPositive = change >= 0;
  const arrow = isPositive ? "↑" : "↓";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none",
        isPositive ? "bg-success/10 text-success" : "bg-error/10 text-error",
      )}
    >
      {arrow} {Math.abs(change).toFixed(1)}%
    </span>
  );
}

const TAGLINE_LEAD = "Decode the ";
const TAGLINE_ACCENT = "XRPL";
const SUBHEAD =
  "Real-time intelligence, analytics, and portfolio tracking for the XRP Ledger.";

// Hero entrance cascade — kept tight on purpose. The old values
// finished the cascade at ~1.3s (CTA at 700ms, stats at 850ms), which
// read as a long wait before the page felt "settled" and also showed
// up as visible lag on per-property animations that inherit this
// delay. The new values trim ~55% off — every element still comes in
// sequence, but the whole cascade completes in ~450ms.
const TITLE_START = 0.03;
const LETTER_GAP = 0.012;
const SUBHEAD_DELAY = 0.22;
const CTA_DELAY = 0.32;
const STATS_DELAY = 0.42;

let heroPlayed = false;

/* ——— Animated text helper ———
 * Same letter-by-letter pattern the old hero used so the new
 * "Decode the XRPL" headline keeps the signature reveal. */
function AnimatedText({
  text,
  className,
  startIndex,
  skip,
}: {
  text: string;
  className?: string;
  startIndex: number;
  skip: boolean;
}) {
  return (
    <>
      {text.split("").map((char, i) => {
        const globalIndex = startIndex + i;
        const isSpace = char === " ";
        return (
          <motion.span
            key={globalIndex}
            className={className}
            aria-hidden="true"
            initial={skip || isSpace ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.22,
              delay: TITLE_START + globalIndex * LETTER_GAP,
              ease: "easeOut",
            }}
          >
            {char}
          </motion.span>
        );
      })}
    </>
  );
}

/* ——— Stat cell ———
 * Label up top (compact uppercase header), value + change pill on a
 * single baseline-aligned row underneath. The change pill sits inline
 * with the value so the eye sweeps "what / how-much / trend" left-to-
 * right per cell. Time-period framing lives in the card header now,
 * so individual cells no longer carry a per-stat "7d" sub-label. */
function Stat({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: number | null;
}) {
  return (
    <div className="min-w-0">
      <p className="font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="truncate font-mono text-cell font-medium tabular-nums text-primary">
          {value}
        </p>
        <ChangePill change={change} />
      </div>
    </div>
  );
}

/* ——— CTA pill ———
 * Wraps a Next `<Link>` in a `motion.div` so the hover/tap squash +
 * spring-release matches every other interactive control on the
 * site (Button, FABs). The Link itself gets the shared
 * `buttonClasses()` styling for visual consistency. */
function HeroCta({
  href,
  variant,
  icon,
  children,
  delay,
  skip,
}: {
  href: string;
  variant: "primary" | "secondary";
  icon: React.ReactNode;
  children: React.ReactNode;
  delay: number;
  skip: boolean;
}) {
  return (
    <motion.div
      initial={skip ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      // Per-property transitions are deliberate: the staggered
      // `delay` is for the one-shot entrance (opacity + y fading up),
      // NOT for scale. Without splitting, Framer applies the entrance
      // delay to every property including the un-hover scale revert
      // — so un-hovering the button waits ~700ms (CTA_DELAY) before
      // the scale animates back to 1.0, which reads as "stuck."
      //   - opacity + y: tween with the staggered entrance delay.
      //   - scale: SPRING.smooth, no delay. Used by both whileHover
      //     and whileTap as the un-press / un-hover transition.
      transition={{
        opacity: { duration: 0.3, delay, ease: "easeOut" },
        y: { duration: 0.3, delay, ease: "easeOut" },
        scale: SPRING.smooth,
      }}
      whileHover={{ scale: HOVER_SCALE, transition: SPRING.smooth }}
      whileTap={{ scale: TAP_SCALE, transition: SPRING.pop }}
      // GPU layer hint — the CTA has text + an icon inside, both of
      // which would re-rasterize per frame of the scale animation
      // without this. Same fix applied to the bento cards.
      style={{ willChange: "transform" }}
      className="inline-block"
    >
      <Link
        href={href}
        className={cn(
          buttonClasses({ variant, size: "lg" }),
          "gap-2 px-6 shadow-card",
        )}
      >
        {icon}
        {children}
      </Link>
    </motion.div>
  );
}

interface DashboardHeroProps {
  /** Four 7D network metrics (current value + period-over-period
   *  change vs. prior 7D). `null` on the value falls back to "—";
   *  `null` on the change hides the pill (insufficient prior data
   *  for a meaningful delta). All four are computed the same way so
   *  the strip can carry a single "7D" indicator in the header. */
  activeWallets: number | null;
  activeWalletsChange: number | null;
  trustLines: number | null;
  trustLinesChange: number | null;
  txVolume: number | null;
  txVolumeChange: number | null;
  /** 7D DEX volume in XRP (sum of XRP-side of all DEX trades over
   *  the last 7 days). Replaces the previous 24h CEX volume from the
   *  price feed so all four stats share a unified time window. */
  dexVolume7dXrp: number | null;
  dexVolume7dChange: number | null;
}

/**
 * Landing-page hero.
 *
 * Centered tagline + subheading + two CTAs (Ask the Ledger,
 * Portfolio) over the animated `HeroGrid`/`FloatingShapes`/
 * `NetworkCanvas` background. Search has moved to the global
 * top bar / mobile FAB so the hero no longer carries its own
 * input — frees the visual centre for the brand statement.
 *
 * Bottom-aligned strip: four glanceable network stats backed by
 * the same ClickHouse queries the Network page uses, plus the
 * shared `AnomalyFeed` underneath so the page always says
 * something live even before the user scrolls.
 *
 * Entrance animations cascade once per session (the
 * module-level `heroPlayed` flag suppresses replay on client
 * navigation back to `/`). Respects `prefers-reduced-motion`.
 */
export default function DashboardHero({
  activeWallets,
  activeWalletsChange,
  trustLines,
  trustLinesChange,
  txVolume,
  txVolumeChange,
  dexVolume7dXrp,
  dexVolume7dChange,
}: DashboardHeroProps) {
  const reduced = useReducedMotion();
  const skip = !!reduced || heroPlayed;

  useEffect(() => {
    heroPlayed = true;
  }, []);

  return (
    <section
      aria-label="Hero"
      // Bleeds under the mobile top bar via the negative top margin;
      // the wrapper's `pt-18` is restored on the section so content
      // doesn't sit underneath the hamburger. Min-h aims for "fill
      // viewport minus a touch of breathing room" — `svh` falls back
      // to `vh` on browsers that don't support it.
      className="relative -mt-18 flex min-h-[calc(100vh-2rem)] min-h-[calc(100svh-2rem)] flex-col overflow-hidden pt-18 md:-mt-3 md:pt-3"
    >
      {/* Animated background layers. */}
      <HeroGrid />
      <FloatingShapes />
      <NetworkCanvas />

      {/* Centered content. `flex-1` so it occupies the slack between
           the top of the hero and the bottom stats strip. */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1
          className="max-w-3xl font-display text-display font-bold leading-display tracking-display text-primary sm:text-display-lg"
          aria-label={`${TAGLINE_LEAD}${TAGLINE_ACCENT}`}
        >
          <AnimatedText text={TAGLINE_LEAD} skip={skip} startIndex={0} />
          <AnimatedText
            text={TAGLINE_ACCENT}
            className="text-brand"
            skip={skip}
            startIndex={TAGLINE_LEAD.length}
          />
        </h1>

        <motion.p
          className="mt-5 max-w-2xl font-body text-ui text-secondary sm:text-body"
          initial={skip ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: SUBHEAD_DELAY, ease: "easeOut" }}
        >
          {SUBHEAD}
        </motion.p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <HeroCta
            href="/asktheledger"
            variant="primary"
            icon={<Sparkles size={18} aria-hidden="true" />}
            delay={CTA_DELAY}
            skip={skip}
          >
            Ask the Ledger
          </HeroCta>
          <HeroCta
            href="/portfolio"
            variant="secondary"
            icon={<LineChart size={18} aria-hidden="true" />}
            delay={CTA_DELAY + 0.08}
            skip={skip}
          >
            Portfolio
          </HeroCta>
        </div>
      </div>

      {/* Bottom-aligned stats strip + anomaly feed. The card uses
           `bg-surface/80 backdrop-blur` so the animated background
           still bleeds through subtly, but the numbers stay legible.
           Entrance is a Y-slide only — no opacity fade — so the data
           is visible from frame 1 even if the cascade animation
           chain hits a snag (the stats are too important to hide
           behind a motion bug). */}
      <motion.div
        initial={skip ? false : { y: 12 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.45, delay: STATS_DELAY, ease: "easeOut" }}
        className="relative z-10 mx-auto w-full max-w-container px-4 pb-6 sm:px-6 sm:pb-8"
      >
        <div className="overflow-hidden rounded-2xl border border-elevated bg-surface/80 shadow-card backdrop-blur-md">
          {/* Card header — small uppercase label + a single "7D" pill
               that frames every stat in the grid below. Replaces the
               per-stat "7d / 24h" sub-labels and signals at a glance
               that all four numbers share the same time window. */}
          <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5 sm:px-5">
            <p className="font-display text-label font-medium uppercase tracking-header text-muted">
              Network Activity
            </p>
            <span className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-pill text-brand">
              7D
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4 sm:divide-x sm:divide-elevated sm:gap-0">
            <div className="sm:px-4">
              <Stat
                label="Active Wallets"
                value={formatCount(activeWallets)}
                change={activeWalletsChange}
              />
            </div>
            <div className="sm:px-4">
              <Stat
                label="Trust Lines"
                value={formatCount(trustLines)}
                change={trustLinesChange}
              />
            </div>
            <div className="sm:px-4">
              <Stat
                label="DEX Volume"
                value={
                  dexVolume7dXrp == null
                    ? "—"
                    : `${formatCount(dexVolume7dXrp)} XRP`
                }
                change={dexVolume7dChange}
              />
            </div>
            <div className="sm:px-4">
              <Stat
                label="Transactions"
                value={formatCount(txVolume)}
                change={txVolumeChange}
              />
            </div>
          </div>
          <div className="border-t border-elevated">
            <AnomalyFeed embedded />
          </div>
        </div>
      </motion.div>
    </section>
  );
}
