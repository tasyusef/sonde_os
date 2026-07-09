"use client";

import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { cn } from "@/lib/utils";

interface CurrentPortfolio {
  xrpBalance: number;
  ownerCount: number;
  /** Live base reserve from server_info (XRP). Falls back to current mainnet value. */
  reserveBase?: number;
  /** Live owner-reserve increment per object (XRP). Falls back to current mainnet value. */
  reserveIncrement?: number;
}

// Current XRPL mainnet values (post-ReserveCut amendment). Used as a safety
// fallback if the API response predates the reserveBase/reserveIncrement fields
// or the server_info request failed.
const DEFAULT_BASE_RESERVE = 1;
const DEFAULT_OWNER_RESERVE = 0.2;

interface Segment {
  label: string;
  value: number;
  color: string;
}

export default function ReserveBreakdown() {
  const { data } = useSWR<CurrentPortfolio>(
    CACHE_KEYS.portfolioCurrent(),
    fetcher,
  );

  if (!data || data.ownerCount == null) return null;

  const baseReserve = data.reserveBase ?? DEFAULT_BASE_RESERVE;
  const ownerReserveUnit = data.reserveIncrement ?? DEFAULT_OWNER_RESERVE;
  const ownerReserve = data.ownerCount * ownerReserveUnit;
  const totalReserve = baseReserve + ownerReserve;
  const spendable = Math.max(0, data.xrpBalance - totalReserve);
  const total = data.xrpBalance || 1;

  const segments: Segment[] = [
    { label: "Spendable", value: spendable, color: "var(--color-success)" },
    { label: "Base Reserve", value: baseReserve, color: "var(--color-tx-escrow)" },
    { label: `Owner Reserve (${data.ownerCount} objects)`, value: ownerReserve, color: "var(--color-tx-offer)" },
  ].filter((s) => s.value > 0);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-elevated px-4 py-3">
      <span className="font-display text-label font-medium uppercase tracking-header text-muted">
        XRP Reserves
      </span>

      {/* Stacked bar */}
      <div className="flex h-3 overflow-hidden rounded-full bg-surface">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className="h-full transition-all duration-300"
            style={{
              width: `${(seg.value / total) * 100}%`,
              backgroundColor: seg.color,
              opacity: 0.7,
            }}
            title={`${seg.label}: ${seg.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} XRP`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: seg.color, opacity: 0.7 }}
            />
            <span className="font-mono text-tag text-muted">{seg.label}</span>
            <span
              className={cn(
                "font-mono text-tag font-medium tabular-nums",
                seg.label === "Spendable" ? "text-success" : "text-secondary",
              )}
            >
              {seg.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} XRP
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
