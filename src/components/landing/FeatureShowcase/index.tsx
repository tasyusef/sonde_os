"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion, type Variants } from "motion/react";
import {
  Activity,
  ArrowUpRight,
  Brain,
  Briefcase,
  LineChart,
  Search,
  Sparkles,
} from "lucide-react";
import { SPRING, TAP_SCALE } from "@/lib/motion";
import { useHoverSupported } from "@/hooks/useHoverSupported";
import { cn } from "@/lib/utils";
import {
  AmmsMock,
  AskLedgerMock,
  ExplorerMock,
  NetworkPulseMock,
  PortfolioMock,
  SmartMoneyMock,
} from "./mocks";

/* ——— Section copy ——— */

const SECTION_KICKER = "What's inside";
const SECTION_TITLE = "Everything on the XRPL,";
const SECTION_TITLE_ACCENT = "decoded.";
const SECTION_SUB =
  "A toolkit for explorers, traders, and analysts who want accurate XRP Ledger data — no inflated mint counts, no stale rollups, no noise.";

/* ——— Bento cards ———
 * Six cells on a 4×3 grid at md+:
 *
 *   ┌─────────────────┬─────────────────┐
 *   │                 │  Smart Money    │
 *   │  Ask the        ├────────┬────────┤
 *   │  Ledger         │ Explor │ AMMs   │
 *   │  (flagship)     │        │        │
 *   ├─────────────────┴────────┴────────┤
 *   │  Network Pulse  │  Portfolio      │
 *   └─────────────────┴─────────────────┘
 *
 * Each card carries a tiny abstract mock of the page it links to.
 * The mocks animate via variant propagation — when the card root
 * flips to `whileHover="hover"`, child motion elements with a
 * matching `hover` variant respond. No JS state, no event handlers
 * inside the mocks. */

interface BentoItem {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  /** Tailwind grid spans for md+. Mobile is a single column. */
  span: string;
  /** Larger type + extra description block for the flagship tile. */
  featured?: boolean;
  /** Abstract preview of the target page. */
  mock: ReactNode;
}

const items: BentoItem[] = [
  {
    href: "/asktheledger",
    title: "Ask the Ledger",
    description:
      "Natural-language queries over every validated XRPL transaction. Ask for charts, tables, anomalies, accounts, trades — get answers in plain English, sourced from the ledger itself.",
    icon: <Sparkles size={22} aria-hidden="true" />,
    span: "md:col-span-2 md:row-span-2",
    featured: true,
    mock: <AskLedgerMock />,
  },
  {
    href: "/smart-money",
    title: "Smart Money",
    description:
      "Algorithmic scoring of XRPL wallets — profitability, win rate, hold time, timing. Follow the addresses that consistently profit on the DEX and AMMs.",
    icon: <Brain size={20} aria-hidden="true" />,
    span: "md:col-span-2",
    mock: <SmartMoneyMock />,
  },
  {
    href: "/network",
    title: "Ledger Explorer",
    description:
      "Every account, transaction, trustline, escrow, offer, and NFT. Streamed live as each ledger closes.",
    icon: <Search size={20} aria-hidden="true" />,
    span: "md:col-span-1",
    mock: <ExplorerMock />,
  },
  {
    href: "/markets",
    title: "AMMs & DEX",
    description:
      "Issued tokens ranked by real trade volume. OHLC, pool composition, holder distribution, top movers.",
    icon: <LineChart size={20} aria-hidden="true" />,
    span: "md:col-span-1",
    mock: <AmmsMock />,
  },
  {
    href: "/network",
    title: "Network Pulse",
    description:
      "Fee burns, transaction volume by type, payment corridors, amendment voting, active-wallet trends, anomaly detection. The clearest picture of XRPL health anywhere.",
    icon: <Activity size={20} aria-hidden="true" />,
    span: "md:col-span-2",
    mock: <NetworkPulseMock />,
  },
  {
    href: "/portfolio",
    title: "Portfolio",
    description:
      "Connect any XRPL wallet. Weighted-average cost basis, AMM positions, realized + unrealized PnL, exportable activity history.",
    icon: <Briefcase size={20} aria-hidden="true" />,
    span: "md:col-span-2",
    mock: <PortfolioMock />,
  },
];

/* ——— Card variants ———
 * `hidden` → `visible` is the on-scroll entrance.
 * `visible` ↔ `hover` is the hover lift + mock animation trigger.
 * The names line up with the mock children's variants so a single
 * `whileHover="hover"` on the parent drives every internal
 * sub-animation without prop-drilling or local state.
 *
 * Bento cards use a custom 1.015 scale instead of the standard
 * `HOVER_SCALE` (1.03) because the cards are large — at button-size,
 * 1.03 reads as a satisfying nudge, but on a 300-400px-wide card it
 * reads as an exaggerated jump. Half the standard scale keeps the
 * lift perceptible without making the card "pop". */
const CARD_HOVER_SCALE = 1.015;

/* Variant builder — pass `hoverSupported = false` to drop the scale
 * lift from the `hover` state. On touch devices the card auto-enters
 * the hover variant when it scrolls into view (so the mocks play),
 * so we don't want the lifted scale to be the permanent rest state
 * mobile users see. */
function makeCardVariants(hoverSupported: boolean): Variants {
  return {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, scale: 1 },
    hover: {
      opacity: 1,
      y: 0,
      scale: hoverSupported ? CARD_HOVER_SCALE : 1,
    },
  };
}

/* ——— BentoCard ———
 * Layout (top-down):
 *   - icon badge + ↗ arrow (fixed row)
 *   - mock area (flex-1)
 *   - title + description (fixed)
 *
 * The flagship tile gets a brand-tinted gradient baked into the
 * Link's own background (not a child `<span>`) so the gradient can't
 * escape the rounded corner clipping — earlier the gradient layer
 * was leaking past the card edge on hover-scale because the
 * positioned-absolute child wasn't being clipped uniformly across
 * all four corners. */
function BentoCard({
  href,
  title,
  description,
  icon,
  span,
  featured,
  mock,
  index,
}: BentoItem & { index: number }) {
  // On hover-capable devices: enter as `visible` (idle mocks), then
  // promote to `hover` when the user moves the cursor over the card.
  // On touch devices: there's no hover gesture, so the mocks would
  // never animate. We promote straight to `hover` when the card
  // enters view — that auto-plays the mocks for mobile users.
  // `makeCardVariants` also drops the 1.015 scale lift on touch so
  // the card doesn't sit at a permanent lifted size at rest.
  const hoverSupported = useHoverSupported();
  const cardVariants = makeCardVariants(hoverSupported);

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      whileInView={hoverSupported ? "visible" : "hover"}
      whileHover={hoverSupported ? "hover" : undefined}
      whileTap={{ scale: TAP_SCALE, transition: SPRING.pop }}
      viewport={{ once: true, margin: "-80px" }}
      // Per-property transitions so hover-out doesn't inherit the
      // entrance `delay`. Scale uses `SPRING.smooth` (damping ratio
      // ~0.86) instead of `SPRING.snap` (~0.73): on a 0.015 scale
      // change the snap spring's mild overshoot reads as a perceptible
      // bounce, smooth settles cleanly with essentially no ringing.
      // Opacity/y still use the staggered fade-up tween.
      transition={{
        opacity: { duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] },
        y: { duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] },
        scale: SPRING.smooth,
      }}
      // Lock the card onto its own GPU compositing layer for the
      // whole lifetime of the component. Without this, every frame
      // of the hover-scale re-rasterizes the title/description text
      // at a slightly different sub-pixel scale, which the eye picks
      // up as text-edge "wiggle." With willChange: transform, the
      // text rasterizes once and the layer itself is transformed —
      // identical motion, zero text jitter.
      style={{ willChange: "transform" }}
      // `overflow-hidden rounded-2xl` on the motion.div itself
      // (outermost layer) — belt and suspenders. The inner Link
      // already has rounded-2xl + overflow-hidden, but when the
      // motion.div hover-scales, GPU compositing was occasionally
      // painting sub-pixels of the gradient into the corner cutout
      // pixels (visible as a faint salmon halo just outside the
      // top-left rounded edge). Clipping at the outermost element
      // too ensures no transform-state can leak the gradient past
      // the curve.
      className={cn("relative overflow-hidden rounded-2xl", span)}
    >
      <Link
        href={href}
        className={cn(
          "group block h-full rounded-2xl border border-elevated transition-colors hover:border-brand/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
          featured ? "p-6 sm:p-8" : "p-5 sm:p-6",
          // Featured gradient lives on the Link's own background so
          // it's part of the element's paint (border-box clips it
          // to the rounded shape) rather than as a child layer that
          // can drift during compositing.
          featured
            ? "bg-gradient-to-br from-brand/12 via-brand/4 to-surface"
            : "bg-surface",
        )}
      >
        <div className="relative flex h-full flex-col gap-4">
          {/* Top row — icon badge + arrow affordance */}
          <div className="flex items-start justify-between gap-3">
            <span
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-xl text-brand",
                featured ? "h-12 w-12 bg-brand/12" : "h-10 w-10 bg-brand/10",
              )}
            >
              {icon}
            </span>
            <ArrowUpRight
              size={18}
              aria-hidden="true"
              className="text-muted transition-colors group-hover:text-brand"
            />
          </div>

          {/* Mock area — fills available space between the top icon
               row and the bottom title block. `min-h-0` lets the
               flex parent shrink the mock if needed in tiny cards. */}
          <div
            className={cn(
              "min-h-0 flex-1",
              // 1x1 cards have very little vertical room; give the
              // mock a sensible floor so it doesn't collapse to ~0px.
              featured ? "min-h-[160px]" : "min-h-[72px]",
            )}
          >
            {mock}
          </div>

          {/* Title + description */}
          <div>
            <h3
              className={cn(
                "font-display font-bold tracking-tight text-primary",
                featured ? "text-heading sm:text-title" : "text-ui sm:text-heading",
              )}
            >
              {title}
            </h3>
            <p
              className={cn(
                "mt-2 font-body leading-relaxed text-secondary",
                featured ? "text-ui sm:text-body" : "text-cell",
              )}
            >
              {description}
            </p>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

/**
 * Bento-style feature showcase. Replaces the previous alternating
 * left/right `FeatureSection` list — denser layout, XRPL-native
 * vocabulary throughout, animated per-feature mocks that trigger on
 * card hover via variant propagation.
 */
export function FeatureShowcase() {
  return (
    <section className="relative">
      {/* Top padding stays generous (separates from the hero); bottom
           is trimmed since `LandingCTA` immediately follows and its own
           top padding + gradient backdrop already provide the section
           break. Symmetric py-24 here + py-20 on the CTA stacked to a
           ~180px dead zone. */}
      <div className="mx-auto max-w-container px-4 pt-16 pb-6 sm:px-6 sm:pt-24 sm:pb-10">
        <header className="mx-auto max-w-3xl text-center">
          <p className="font-display text-label font-medium uppercase tracking-header text-muted">
            {SECTION_KICKER}
          </p>
          <h2 className="mt-3 font-display text-display font-bold leading-display tracking-display text-primary sm:text-display-lg">
            {SECTION_TITLE}{" "}
            <span className="text-brand">{SECTION_TITLE_ACCENT}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl font-body text-ui text-secondary sm:text-body">
            {SECTION_SUB}
          </p>
        </header>

        {/* Bento grid — 4 cols × auto rows at md+, single column on
             mobile. `auto-rows-fr` keeps the 1×1 tiles square-ish;
             the flagship tile spans 2 cols × 2 rows via its `span`. */}
        <div className="mt-12 grid grid-cols-1 gap-4 sm:mt-16 md:grid-cols-4 md:auto-rows-fr md:gap-5">
          {items.map((item, i) => (
            <BentoCard key={item.title} {...item} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default FeatureShowcase;
