/**
 * Centralized chart color system.
 *
 * All chart colors reference CSS custom properties from globals.css.
 * Recharts requires resolved hex values at render time, so we provide
 * both the CSS variable reference (for Tailwind classes) and the
 * resolved hex value (for Recharts stroke/fill props).
 *
 * When adding new chart colors, add the token to globals.css first,
 * then reference it here.
 */

/* ------------------------------------------------------------------ */
/*  Base chart chrome (axes, grids, backgrounds)                       */
/* ------------------------------------------------------------------ */

export const CHART_CHROME = {
  brand: "var(--color-brand)",
  muted: "var(--color-muted)",
  elevated: "var(--color-elevated)",
  surface: "var(--color-surface)",
  primary: "var(--color-primary)",
} as const;

/* ------------------------------------------------------------------ */
/*  Transaction type family colors                                      */
/* ------------------------------------------------------------------ */

export const TX_FAMILY_COLORS: Record<string, string> = {
  Payment: "var(--color-tx-payment)",
  Offer: "var(--color-tx-offer)",
  NFToken: "var(--color-tx-nft)",
  "Trust Line": "var(--color-tx-trust)",
  AMM: "var(--color-tx-amm)",
  Escrow: "var(--color-tx-escrow)",
  Account: "var(--color-tx-account)",
  "Check & Channel": "var(--color-tx-check)",
  Other: "var(--color-tx-other)",
};

/* ------------------------------------------------------------------ */
/*  Multi-series palette (16 colors for pool/token breakdowns)          */
/*                                                                      */
/*  Order: high-contrast distinguishable colors first, avoid adjacent   */
/*  hues being too similar. Covers up to 16 series without repeating.   */
/*  Used by AMMFeeRevenue pool view, and any future multi-line charts.  */
/* ------------------------------------------------------------------ */

export const MULTI_SERIES_PALETTE = [
  "var(--color-tx-amm)",        // pink
  "var(--color-chart-blue)",    // blue
  "var(--color-chart-emerald)", // emerald
  "var(--color-chart-amber)",   // amber
  "var(--color-tx-nft)",        // violet
  "var(--color-tx-escrow)",     // orange
  "var(--color-chart-teal)",    // teal
  "var(--color-tx-check)",      // red
  "var(--color-chart-indigo)",  // indigo
  "var(--color-tx-trust)",      // green
  "var(--color-chart-cyan)",    // cyan
  "var(--color-chart-rose)",    // rose
  "var(--color-chart-lime)",    // lime
  "var(--color-chart-fuchsia)", // fuchsia
  "var(--color-chart-sky)",     // sky
  "var(--color-chart-peach)",   // peach
];

/* ------------------------------------------------------------------ */
/*  Currency-specific colors (for corridor / payment flow charts)       */
/* ------------------------------------------------------------------ */

export const CURRENCY_COLORS: Record<string, string> = {
  XRP: "var(--color-tx-payment)",
  USD: "var(--color-tx-trust)",
  EUR: "var(--color-tx-nft)",
  BTC: "var(--color-tx-offer)",
  ETH: "var(--color-tx-amm)",
};

export const CURRENCY_FALLBACK_PALETTE = [
  "var(--color-tx-escrow)",
  "var(--color-tx-check)",
  "var(--color-chart-teal)",
  "var(--color-brand)",
  "var(--color-chart-indigo)",
  "var(--color-success)",
  "var(--color-chart-amber)",
  "var(--color-chart-blue)",
  "var(--color-chart-cyan)",
  "var(--color-chart-rose)",
  "var(--color-chart-lime)",
  "var(--color-chart-fuchsia)",
  "var(--color-chart-sky)",
  "var(--color-chart-peach)",
  "var(--color-chart-emerald)",
  "var(--color-tx-nft)",
];
