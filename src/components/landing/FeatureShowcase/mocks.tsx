"use client";

import { motion, type Variants } from "motion/react";
import { Sparkles } from "lucide-react";

/**
 * Bento-card feature mocks. Each one is a tiny abstract
 * representation of the page it links to.
 *
 * Animation model: every mock has a static "idle" frame and a
 * looping "hover" sequence. They activate via Framer variant
 * propagation — the parent card sets `whileHover="hover"`, which
 * propagates down to any child motion element with a matching
 * `visible` (idle) and `hover` (animated loop) variant. No React
 * state, no setInterval, no hover event handlers inside the mocks.
 *
 * Authoring rules:
 *   - Tile-shaped, fill their container.
 *   - Use brand + elevated tokens only.
 *   - At rest: show one representative frame (first prompt, top
 *     leaderboard row, candles at neutral, etc.). At hover: cycle.
 *   - Cycle durations vary by mock so the bento doesn't sync to a
 *     single beat. Each `repeat: Infinity` inside a `hover` variant
 *     stops the moment the user un-hovers.
 *   - Pure SVG/HTML — no chart library.
 *
 * `cycleTimes(i, count)` returns the four normalised (0–1)
 * keyframe time points where item `i` fades in → holds → fades out
 * → next. Used to stagger overlapping loops.
 */
function cycleTimes(i: number, count: number, holdRatio = 0.85): number[] {
  const slot = 1 / count;
  const fadeMargin = (slot * (1 - holdRatio)) / 2;
  return [
    i * slot,
    i * slot + fadeMargin,
    (i + 1) * slot - fadeMargin,
    (i + 1) * slot,
  ];
}

/* ——— Ask the Ledger ———
 * Chat-style mock. The bubbles mirror the real Ask the Ledger page:
 * user prompts sit right-aligned in brand-tinted rounded rectangles,
 * AI responses sit left-aligned in elevated cards with a "clickhouse"
 * source chip + a small inline visualization (bar chart or ranked
 * table) — same vocabulary the real page uses.
 *
 * Animation model is flipped compared to the rest of the bento:
 *   - Idle state = end of loop (all four bubbles visible, full
 *     conversation on display). At rest the card says "this is the
 *     kind of thing Sonde answers" without requiring interaction.
 *   - On hover, the loop fades bubbles 1–3 out, then re-enters them
 *     sequentially (~25% / 50% / 75% of cycle), ending back at
 *     all-visible. Start frame and end frame both match idle, so
 *     hover-in / hover-out have no jarring snap.
 *
 * Bubble 0 (the first user prompt) is always rendered as a plain div
 * — it never animates, it just anchors the conversation. */
const CHAT_TURNS = [
  { type: "user" as const, text: "which wallets bought RLUSD?" },
  {
    type: "ai" as const,
    rows: [
      { addr: "rPx9...4kF7", value: 92 },
      { addr: "rDE5...PEvR", value: 68 },
      { addr: "rUiA...M7nz", value: 54 },
    ],
    style: "chart" as const,
  },
  { type: "user" as const, text: "top smart-money traders by ROI" },
  {
    type: "ai" as const,
    rows: [
      { addr: "rN3K...91tB", value: 147 },
      { addr: "rZsM...vQ4F", value: 96 },
      { addr: "rJpT...8aCe", value: 71 },
    ],
    style: "table" as const,
  },
];
const CHAT_CYCLE = 7;

function UserBubble({ text }: { text: string }) {
  // Matches the real /asktheledger user message: rounded-2xl,
  // brand/10 background, no chat-tail, no border. Slightly smaller
  // text than the real page so it fits in the bento mock area.
  return (
    <div className="rounded-2xl bg-brand/10 px-4 py-2.5">
      <span className="font-mono text-tag text-primary">{text}</span>
    </div>
  );
}

/* AI bubble — mirrors the real assistant message: elevated card,
 * a coloured source chip ("clickhouse" in chart-blue), then content.
 * The mock supports two content styles so the two AI responses don't
 * look identical:
 *   - "chart": three horizontal bars sized by `value` (0–100). Mimics
 *     a "wallets by purchase volume" answer.
 *   - "table": three ranked rows with address + a percentage value.
 *     Mimics a "top traders by ROI" answer.
 * Both feel like real query results without pulling in Recharts. */
function AiBubble({
  rows,
  style,
}: {
  rows: readonly { addr: string; value: number }[];
  style: "chart" | "table";
}) {
  return (
    <div className="flex max-w-full flex-col gap-2 rounded-2xl bg-elevated px-4 py-3">
      {/* Source chip — same vocabulary as the real page's message
           header ("clickhouse" / "postgres" colored tags). */}
      <div className="flex items-center gap-1.5">
        <Sparkles size={11} className="text-brand" aria-hidden="true" />
        <span className="rounded-tag bg-chart-blue/10 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-pill text-chart-blue">
          clickhouse
        </span>
      </div>

      {style === "chart" ? (
        <div className="flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-[68px] shrink-0 truncate font-mono text-[10px] text-muted">
                {r.addr}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-brand/60"
                  style={{ width: `${r.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-2 border-b border-elevated/60 py-1 last:border-b-0"
            >
              <span className="w-3 font-mono text-[10px] font-semibold text-muted">
                {i + 1}
              </span>
              <span className="flex-1 truncate font-mono text-[10px] text-secondary">
                {r.addr}
              </span>
              <span className="font-mono text-[10px] font-medium text-success">
                +{r.value}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AskLedgerMock() {
  return (
    <div
      aria-hidden="true"
      className="relative h-full w-full overflow-hidden rounded-xl border border-elevated/60 bg-elevated/30 p-4"
    >
      {/* Chat thread, stacked top-down. User bubbles right-aligned,
           AI bubbles left-aligned. */}
      <div className="flex h-full flex-col gap-2">
        {CHAT_TURNS.map((turn, i) => {
          const isUser = turn.type === "user";
          const align = isUser ? "self-end" : "self-start";

          // Bubble 0 = always-visible anchor (first user prompt).
          // Doesn't animate, doesn't react to variants. The type-guard
          // tells TS bubble 0 carries the `text` property; the array
          // is structured so this is always true.
          if (i === 0 && turn.type === "user") {
            return (
              <div key={i} className={`max-w-[85%] ${align}`}>
                <UserBubble text={turn.text} />
              </div>
            );
          }

          // Bubbles 1–3: visible at rest, fade out on hover, then
          // re-enter sequentially through the cycle so the loop both
          // starts AND ends at "all visible". `enterAt` is i*slot of
          // the cycle (bubble 1 enters at ~25%, 2 at ~50%, 3 at ~75%).
          //
          // Keyframe sequence (5 stops):
          //   t=0       opacity 1, y 0,  blur 0    (matches idle)
          //   t=0.06    opacity 0, y -4, blur 1.2  (fade out + soften)
          //   t=enterAt opacity 0, y 6,  blur 1.2  (snap mid-fade)
          //   t=enterAt+0.05 opacity 1, y 0, blur 0.4 (enter, still soft)
          //   t=1       opacity 1, y 0,  blur 0    (matches idle)
          //
          // The y-snap from -4 → 6 happens during the invisible window
          // so the eye never sees it. The `filter: blur(...)` keyframe
          // is the CLAUDE.md motion-blur pattern — subtle softening
          // during the morph masks sub-pixel jitter the eye picks up
          // as "not quite smooth" on small-text bubbles. Tapers back
          // to 0 at rest so static type stays crisp. willChange hints
          // the browser to keep the element on its own GPU layer
          // during the loop, which makes the filter animation cheap. */
          const slot = 1 / CHAT_TURNS.length;
          const enterAt = i * slot;
          return (
            <motion.div
              key={i}
              className={`max-w-[85%] ${align}`}
              style={{ willChange: "transform, opacity, filter" }}
              variants={{
                visible: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
                hover: {
                  opacity: [1, 0, 0, 1, 1],
                  scale: [1, 0.96, 0.94, 1, 1],
                  y: [0, -4, 6, 0, 0],
                  filter: [
                    "blur(0px)",
                    "blur(1.2px)",
                    "blur(1.2px)",
                    "blur(0.4px)",
                    "blur(0px)",
                  ],
                  transition: {
                    duration: CHAT_CYCLE,
                    times: [0, 0.06, enterAt, enterAt + 0.05, 1],
                    repeat: Infinity,
                    ease: "easeOut",
                  },
                },
              }}
            >
              {turn.type === "user" ? (
                <UserBubble text={turn.text} />
              ) : (
                <AiBubble rows={turn.rows} style={turn.style} />
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ——— Smart Money ———
 * A miniature leaderboard. Each row's bar is sized PROPORTIONALLY
 * to that trader's PnL (so 147% reads visibly larger than 82%
 * reads visibly larger than 71%) — the previous version pinned every
 * bar to a fixed 44px width and only varied them via an arbitrary
 * `scaleX` cycle, so bars 2 and 3 looked identical despite different
 * PnL values, and the bar growth/shrink read as forced (it wasn't
 * actually representing anything).
 *
 * Hover animation now: a brand-coloured "scanline" shimmer sweeps
 * left-to-right across the rank-1 bar — same visual language as a
 * live data-feed indicator. The rest of the board stays still
 * (it's a leaderboard, not a slot machine), so the eye is drawn to
 * the active leader without the whole card flickering. Rank colours
 * are static too: rank 1 always in brand, others muted — like the
 * real Smart Money page treats top-rank highlighting. */
const SM_ROWS = [
  { rank: 1, addr: "rPx9...4kF7", pnl: 147 },
  { rank: 2, addr: "rDE5...PEvR", pnl: 82 },
  { rank: 3, addr: "rUiA...M7nz", pnl: 71 },
] as const;
const SM_MAX_BAR_PX = 60; // longest bar (rank 1) renders this wide
const SM_TOP_PNL = SM_ROWS[0].pnl; // baseline for proportional sizing
const SM_SHIMMER_WIDTH_PX = 14;
const SM_CYCLE = 2.4; // seconds for one shimmer sweep

export function SmartMoneyMock() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full w-full flex-col justify-center gap-1.5 rounded-xl border border-elevated/60 bg-elevated/30 p-3"
    >
      {SM_ROWS.map((r, i) => {
        const isLeader = i === 0;
        const barWidth = Math.round((r.pnl / SM_TOP_PNL) * SM_MAX_BAR_PX);
        // Stagger each row's shimmer by ~0.3s so the three bars
        // don't pulse in lockstep — reads as a wave cascading down
        // the leaderboard rather than three synchronised flashes.
        const shimmerDelay = i * 0.3;
        return (
          <div
            key={r.rank}
            className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5"
          >
            <span
              className={`font-mono text-tag font-semibold ${
                isLeader ? "text-brand" : "text-muted"
              }`}
            >
              {r.rank}
            </span>
            <span className="font-mono text-tag text-secondary">{r.addr}</span>
            <div className="ml-auto flex items-center gap-2">
              {/* Bar — width pinned to the PnL ratio of this trader
                   vs. the top trader (rank 1 = 60px, rank 2 ≈ 33px,
                   rank 3 ≈ 29px). Overflow-hidden so the shimmer
                   overlay can't bleed past the rounded ends. */}
              <div
                className="relative h-2 overflow-hidden rounded-full bg-brand/30"
                style={{ width: barWidth }}
              >
                <motion.div
                  className="absolute inset-y-0 rounded-full bg-brand"
                  style={{
                    width: SM_SHIMMER_WIDTH_PX,
                    willChange: "transform",
                  }}
                  variants={{
                    // At rest: shimmer parked just inside the left
                    // edge so the bar reads as "filled" with brand
                    // colour, like a regular progress bar segment.
                    visible: { x: 0 },
                    hover: {
                      // Sweep from off-screen-left → past the right
                      // edge → reset. Linear ease so the motion is
                      // a steady scan, not a deceleration; matches
                      // the "live data feed" reading. Per-row delay
                      // staggers the wave down the leaderboard.
                      x: [
                        -SM_SHIMMER_WIDTH_PX,
                        barWidth,
                        -SM_SHIMMER_WIDTH_PX,
                      ],
                      transition: {
                        duration: SM_CYCLE,
                        times: [0, 0.55, 1],
                        repeat: Infinity,
                        ease: "linear",
                        delay: shimmerDelay,
                      },
                    },
                  }}
                />
              </div>
              <span
                className={`font-mono text-tag font-medium tabular-nums ${
                  isLeader ? "text-brand" : "text-success"
                }`}
              >
                +{r.pnl}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ——— Ledger Explorer ———
 * Idle: first entry shown.
 * Hover: 3 entries cycle as a vertical CAROUSEL — entries stacked in
 * a column, container clips to one row, the column translates
 * upward to reveal each entry in turn. A duplicate of entry 0 sits
 * at the bottom of the stack so the slide can continue past the
 * last entry, then the column snaps back to y=0 (invisible because
 * both positions show the same entry).
 *
 * Why a carousel instead of the previous cross-fade-on-absolute-
 * positioned-entries pattern:
 *   - Cross-fade meant two entries are partially visible at the
 *     slot boundary, with text ghosting through each other. The
 *     6px y-shift was too subtle to read as a "slide" — looked
 *     like a flicker.
 *   - A carousel is pure transform on a single element. GPU stays
 *     happy, no rasterization per frame, no opacity interpolation
 *     headaches. Slides read as slides because the whole row IS
 *     sliding.
 *
 * Both the query input text AND the result row use this same
 * pattern (same timing, different row heights), so they stay
 * synced — when the query swaps to a new address the result row
 * swaps to match in lockstep. */
const EXPLORER_ITEMS = [
  {
    query: "rPx9...4kF7",
    tag: "ACCT",
    tagBg: "bg-tx-payment/10",
    tagFg: "text-tx-payment",
    info: "12.5K txns · 4y old",
  },
  {
    query: "rDE5...PEvR",
    tag: "AMM",
    tagBg: "bg-success/10",
    tagFg: "text-success",
    info: "$2.1M TVL · USD/XRP",
  },
  {
    query: "rUiA...M7nz",
    tag: "ISSU",
    tagBg: "bg-brand/12",
    tagFg: "text-brand",
    info: "12K trustlines",
  },
] as const;
const EXPLORER_CYCLE = 6;

/* Row heights in px — kept as constants so the carousel y-translate
 * keyframes stay in sync with the actual rendered row height. If
 * either is changed, update both halves. */
const EXPLORER_QUERY_ROW_PX = 16; // matches `h-4`
const EXPLORER_RESULT_ROW_PX = 28; // matches `h-7`

/* Carousel-stack y keyframes for N+1 entries (the +1 is the wrap
 * duplicate at the bottom of the stack). Each "slide" segment is
 * ~0.06 of the cycle, holds occupy the rest. Final slide ends at
 * y = -N * rowPx (showing the duplicate of entry 0), then the loop
 * restarts and y jumps to 0 — invisible because the rendered pixels
 * are identical at both positions. */
function explorerCarouselKeyframes(rowPx: number) {
  return {
    y: [0, 0, -rowPx, -rowPx, -2 * rowPx, -2 * rowPx, -3 * rowPx],
    times: [0, 0.3, 0.36, 0.63, 0.69, 0.94, 1.0],
  };
}

export function ExplorerMock() {
  const queryKf = explorerCarouselKeyframes(EXPLORER_QUERY_ROW_PX);
  const resultKf = explorerCarouselKeyframes(EXPLORER_RESULT_ROW_PX);

  // Wrap the items array — appending entry 0 to the end so the
  // carousel's final slide lands on the same content it started
  // with, allowing a seamless snap back to y=0 at the loop boundary.
  const carouselItems = [...EXPLORER_ITEMS, EXPLORER_ITEMS[0]];

  return (
    <div
      aria-hidden="true"
      className="relative flex h-full w-full flex-col justify-center gap-2 rounded-xl border border-elevated/60 bg-elevated/30 p-3"
    >
      {/* Query input — caret always blinks (it's a UI affordance,
           not a feature loop). */}
      <div className="relative flex items-center gap-2 rounded-lg border border-elevated bg-surface px-2.5 py-1.5">
        <motion.span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Query text carousel — clipped to one row's height,
             stacked items inside translate upward to reveal each. */}
        <div className="relative h-4 flex-1 overflow-hidden">
          <motion.div
            className="flex flex-col"
            style={{ willChange: "transform" }}
            variants={{
              visible: { y: 0 },
              hover: {
                y: queryKf.y,
                transition: {
                  duration: EXPLORER_CYCLE,
                  times: queryKf.times,
                  repeat: Infinity,
                  ease: [0.65, 0, 0.35, 1],
                },
              },
            }}
          >
            {carouselItems.map((entry, i) => (
              <span
                key={i}
                className="flex h-4 items-center font-mono text-tag text-muted"
              >
                {entry.query}
              </span>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Result row carousel — same pattern, taller row height.
           The bg-surface card is part of each entry so it slides
           along with the content (vs. living on the container) —
           gives a clean "this card slides up, next card slides in"
           silhouette. */}
      <div className="relative h-7 overflow-hidden">
        <motion.div
          className="flex flex-col"
          style={{ willChange: "transform" }}
          variants={{
            visible: { y: 0 },
            hover: {
              y: resultKf.y,
              transition: {
                duration: EXPLORER_CYCLE,
                times: resultKf.times,
                repeat: Infinity,
                ease: [0.65, 0, 0.35, 1],
              },
            },
          }}
        >
          {carouselItems.map((entry, i) => (
            <div
              key={i}
              className="flex h-7 items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5"
            >
              <span
                className={`rounded-tag px-1.5 py-0.5 font-mono text-tag font-medium ${entry.tagBg} ${entry.tagFg}`}
              >
                {entry.tag}
              </span>
              <span className="font-mono text-tag text-secondary">
                {entry.info}
              </span>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

/* ——— AMMs & DEX ———
 * Idle: static candles.
 * Hover: candles bob on independent slow loops + the last two
 * candles "live tick". */
const AMM_CANDLES = [
  { top: 24, body: 14, color: "success" as const },
  { top: 18, body: 22, color: "error" as const },
  { top: 12, body: 16, color: "success" as const },
  { top: 20, body: 20, color: "success" as const },
  { top: 8, body: 26, color: "error" as const },
  { top: 14, body: 18, color: "success" as const },
  { top: 6, body: 30, color: "success" as const },
  { top: 10, body: 24, color: "error" as const },
];

const candleVariants: Variants = {
  visible: { y: 0, scaleY: 1 },
  hover: (custom: { phase: number; emphasis: number }) => ({
    y: [0, -1 - custom.emphasis * 3, 0, -0.5, 0],
    scaleY: [1, 1 + custom.emphasis * 0.12, 1, 1.05, 1],
    transition: {
      duration: 1.6 + custom.phase * 0.9,
      repeat: Infinity,
      ease: "easeInOut",
    },
  }),
};

export function AmmsMock() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full w-full items-end justify-center gap-1.5 overflow-hidden rounded-xl border border-elevated/60 bg-elevated/30 p-3"
    >
      {AMM_CANDLES.map((c, i) => {
        const emphasis = i >= AMM_CANDLES.length - 2 ? 1 : 0.25;
        const phase = (i * 0.27) % 1;
        return (
          <motion.div
            key={i}
            className="flex origin-bottom flex-col items-center"
            custom={{ phase, emphasis }}
            variants={candleVariants}
          >
            <div className="w-px bg-elevated" style={{ height: c.top }} />
            <div
              className={`w-1.5 rounded-sm ${
                c.color === "success" ? "bg-success/70" : "bg-error/70"
              }`}
              style={{ height: c.body }}
            />
          </motion.div>
        );
      })}
    </div>
  );
}

/* ——— Network Pulse ———
 * Idle: bars at mid-height, static.
 * Hover: each bar oscillates on its own phase + envelope, audio-
 * visualiser style. */
const networkBars = [
  0.4, 0.7, 0.5, 0.9, 0.3, 0.8, 0.55, 0.95, 0.4, 0.7, 0.5, 0.85,
];

const networkBarVariants: Variants = {
  visible: { scaleY: 0.55 },
  hover: (custom: number) => ({
    scaleY: [0.45, 0.55 + custom * 0.45, 0.45],
    transition: {
      duration: 0.85 + custom * 0.9,
      repeat: Infinity,
      ease: "easeInOut",
    },
  }),
};

export function NetworkPulseMock() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center gap-1.5 rounded-xl border border-elevated/60 bg-elevated/30 p-3"
    >
      {networkBars.map((h, i) => (
        <motion.div
          key={i}
          className="w-1.5 origin-bottom rounded-full bg-brand/70"
          style={{ height: 40 }}
          custom={h}
          variants={networkBarVariants}
        />
      ))}
    </div>
  );
}

/* ——— Portfolio ———
 * Idle: donut at first allocation (55% XRP / 22% AMMs / 23% Other).
 * Hover: slices oscillate through four allocations over 12s. */
const PORTFOLIO_XRP_KF = [0.55, 0.62, 0.48, 0.52, 0.55];
const PORTFOLIO_AMM_KF = [0.22, 0.18, 0.30, 0.26, 0.22];
const PORTFOLIO_CYCLE = 8;

export function PortfolioMock() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center gap-4 rounded-xl border border-elevated/60 bg-elevated/30 p-3"
    >
      <svg
        width="68"
        height="68"
        viewBox="0 0 36 36"
        aria-hidden="true"
        className="-rotate-90"
      >
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="4"
          className="stroke-elevated"
        />
        <motion.circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className="stroke-brand"
          variants={{
            visible: { pathLength: PORTFOLIO_XRP_KF[0] },
            hover: {
              pathLength: PORTFOLIO_XRP_KF,
              transition: {
                duration: PORTFOLIO_CYCLE,
                repeat: Infinity,
                ease: "easeInOut",
              },
            },
          }}
        />
        <motion.circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className="stroke-success/70"
          variants={{
            visible: {
              pathLength: PORTFOLIO_AMM_KF[0],
              rotate: PORTFOLIO_XRP_KF[0] * 360,
            },
            hover: {
              pathLength: PORTFOLIO_AMM_KF,
              rotate: PORTFOLIO_XRP_KF.map((v) => v * 360),
              transition: {
                duration: PORTFOLIO_CYCLE,
                repeat: Infinity,
                ease: "easeInOut",
              },
            },
          }}
          style={{ originX: "50%", originY: "50%" }}
        />
      </svg>

      <div className="flex flex-col gap-1.5">
        <LegendRow color="bg-brand" label="XRP" keyframes={PORTFOLIO_XRP_KF} />
        <LegendRow
          color="bg-success"
          label="AMMs"
          keyframes={PORTFOLIO_AMM_KF}
        />
        <LegendRow
          color="bg-elevated"
          label="Other"
          keyframes={PORTFOLIO_XRP_KF.map(
            (v, i) => 1 - v - PORTFOLIO_AMM_KF[i],
          )}
          muted
        />
      </div>
    </div>
  );
}

function LegendRow({
  color,
  label,
  keyframes,
  muted,
}: {
  color: string;
  label: string;
  keyframes: number[];
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
      <div className="relative h-3 w-16">
        {keyframes.slice(0, -1).map((pct, i) => {
          const times = cycleTimes(i, keyframes.length - 1);
          return (
            <motion.span
              key={i}
              className={`absolute inset-0 font-mono text-tag tabular-nums ${
                muted ? "text-muted" : "text-secondary"
              }`}
              style={{ willChange: "opacity, filter" }}
              variants={{
                visible: {
                  opacity: i === 0 ? 1 : 0,
                  filter: "blur(0px)",
                },
                hover: {
                  opacity: [0, 1, 1, 0],
                  filter: [
                    "blur(0.6px)",
                    "blur(0px)",
                    "blur(0px)",
                    "blur(0.6px)",
                  ],
                  transition: {
                    duration: PORTFOLIO_CYCLE,
                    times,
                    repeat: Infinity,
                    ease: "easeInOut",
                  },
                },
              }}
            >
              {label} {Math.round(pct * 100)}%
            </motion.span>
          );
        })}
      </div>
    </div>
  );
}
