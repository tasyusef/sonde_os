/**
 * Shared token types and pure utility functions.
 * Safe to import from both server and client components.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TokenMetrics {
  price: number | null;
  volume24h: number | null;
  volume7d: number | null;
  marketcap: number | null;
  holders: number | null;
  trustlines: number | null;
  totalSupply: number | null;
}

export interface TokenMeta {
  name: string | null;
  icon: string | null;
  issuerName: string | null;
}

export interface TokenListItem {
  currency: string;
  currencyDisplay: string;
  issuer: string;
  meta: TokenMeta;
  metrics: TokenMetrics;
}

export type VolumePeriod = "24h" | "7d";

/* ------------------------------------------------------------------ */
/*  Pure utility functions                                             */
/* ------------------------------------------------------------------ */

export function sortTokensByVolume(
  tokens: TokenListItem[],
  period: VolumePeriod = "24h",
  limit = 5,
): TokenListItem[] {
  const key: keyof TokenMetrics = period === "7d" ? "volume7d" : "volume24h";
  return [...tokens]
    .filter((t) => (t.metrics[key] ?? 0) > 0)
    .sort((a, b) => (b.metrics[key] ?? 0) - (a.metrics[key] ?? 0))
    .slice(0, limit);
}
