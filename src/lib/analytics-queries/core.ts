/**
 * Shared deps, cache, types, and helpers for analytics queries.
 */

import "server-only";
import { LRUCache } from "../cache";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Convert a drops string/number to XRP using BigInt to avoid overflow. */
export function dropsToXrpNum(drops: string | number | bigint): number {
  const big = typeof drops === "bigint" ? drops : BigInt(String(drops).split(".")[0] || "0");
  return Number(big / 1_000_000n) + Number(big % 1_000_000n) / 1_000_000;
}

/* ------------------------------------------------------------------ */
/*  Response cache (30s TTL)                                           */
/* ------------------------------------------------------------------ */

export const analyticsCache = new LRUCache<unknown>(50, 30_000);

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type Period = "7d" | "30d" | "90d" | "all";

export const VALID_PERIODS = ["7d", "30d", "90d", "all"] as const;

/* ------------------------------------------------------------------ */
/*  Period helper                                                       */
/* ------------------------------------------------------------------ */

export function periodToCutoffDate(period: Period): string | null {
  const now = new Date();
  switch (period) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    case "all":
      return null;
  }
}
