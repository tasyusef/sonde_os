"use client";

import { useState } from "react";
import useSWR from "swr";
import Image from "next/image";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import { CACHE_KEYS } from "@/lib/swr-config";
import type { TokenMoverEntry } from "@/types/analytics";

type Period = "24h" | "7d" | "30d";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

function formatVolume(xrp: number): string {
  if (xrp >= 1_000_000) return `${(xrp / 1_000_000).toFixed(2)}M`;
  if (xrp >= 1_000) return `${(xrp / 1_000).toFixed(1)}K`;
  return xrp.toFixed(0);
}

function formatChange(pct: number | null): { text: string; className: string } {
  if (pct === null) return { text: "NEW", className: "text-brand" };
  if (pct >= 0) return { text: `+${pct.toFixed(1)}%`, className: "text-success" };
  return { text: `${pct.toFixed(1)}%`, className: "text-error" };
}

export function TopTokenMovers() {
  const [period, setPeriod] = useState<Period>("24h");

  const { data: raw, isLoading, isValidating } = useSWR<{
    movers: TokenMoverEntry[];
  }>(CACHE_KEYS.tokenMovers(period));

  const loading = isLoading || isValidating;
  const movers = raw?.movers ?? [];

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Top Token Movers"
        subtitle={
          <span className="hidden font-mono text-cell font-medium text-muted sm:inline">
            By XRP volume vs prior period
          </span>
        }
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div className={`relative transition-opacity ${loading ? "opacity-40" : "opacity-100"}`}>
        {movers.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center p-4">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading token movers..." : "No token volume data available"}
            </p>
          </div>
        ) : (
          <div className="px-4 py-3">
            <table className="w-full">
              <thead>
                <tr>
                  <th scope="col" className="pb-1 text-left font-display text-tag font-medium uppercase tracking-header text-muted">
                    Token
                  </th>
                  <th scope="col" className="pb-1 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                    Volume (XRP)
                  </th>
                  <th scope="col" className="pb-1 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {movers.map((m) => {
                  const change = formatChange(m.changePercent);
                  return (
                    <tr key={`${m.currency}:${m.issuer}`} className="border-b border-elevated last:border-b-0">
                      <td className="py-row-compact font-mono text-cell">
                        <div className="flex items-center gap-2">
                          {m.icon && (
                            <Image
                              src={m.icon}
                              alt=""
                              width={20}
                              height={20}
                              className="h-5 w-5 rounded-full"
                              unoptimized
                            />
                          )}
                          <span className="font-mono text-cell font-medium text-primary">
                            {m.currencyDisplay}
                          </span>
                          {m.issuerName && (
                            <span className="hidden font-display text-tag text-muted sm:inline">
                              ({m.issuerName})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-row-compact text-right font-mono text-cell tabular-nums text-secondary">
                        {formatVolume(m.currentVolume)}
                      </td>
                      <td className={`py-row-compact text-right font-mono text-cell tabular-nums font-medium ${change.className}`}>
                        {change.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default TopTokenMovers;
