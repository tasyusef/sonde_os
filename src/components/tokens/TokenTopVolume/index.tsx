"use client";

import { useState } from "react";
import Image from "next/image";
import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import {
  type TokenListItem,
  type VolumePeriod,
  sortTokensByVolume,
} from "@/lib/token-types";
import { formatXrp } from "@/lib/format";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import { cn } from "@/lib/utils";

const PERIODS: { value: VolumePeriod; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
];

interface TokenListResponse {
  tokens: TokenListItem[] | null;
  total?: number;
}

/**
 * Top tokens by XRP-volume — self-fetching analytics card. Fetches
 * the first 100 tokens from `/api/tokens/list` (which is CH-backed
 * via `mv_token_volume_hourly`) and surfaces the top 5 by the
 * selected period's volume metric.
 *
 * Visually mirrors `TokenVelocityChart`: same table chrome (column
 * headers in uppercase tracking-header text, row dividers via
 * border-b on each tr), same row layout (rank cell + icon-name-
 * issuer inline cell + right-aligned value cell with a relative-
 * scale bar). The two cards now read as a consistent pair when
 * stacked on the analytics tab.
 */
export default function TokenTopVolume() {
  const [period, setPeriod] = useState<VolumePeriod>("24h");
  const { data, isLoading } = useSWR<TokenListResponse>(
    CACHE_KEYS.tokenList(0, 100),
    fetcher,
    { keepPreviousData: true },
  );

  const tokens = data?.tokens ?? null;
  const sorted = tokens ? sortTokensByVolume(tokens, period, 5) : null;

  // Max volume across the visible rows — used to scale the
  // volume-column bar in each row, the same pattern the Velocity
  // card uses on its rightmost column.
  const maxVolume =
    sorted && sorted.length > 0
      ? Math.max(
          ...sorted.map((t) =>
            (period === "7d" ? t.metrics.volume7d : t.metrics.volume24h) ?? 0,
          ),
          1,
        )
      : 1;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Top Tokens"
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div className={cn("transition-opacity", isLoading && "opacity-40")}>
        {isLoading && !sorted ? (
          <div className="space-y-2 px-4 py-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse motion-reduce:animate-none rounded bg-elevated"
              />
            ))}
          </div>
        ) : sorted && sorted.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-elevated">
                  {/* Same column-padding rhythm as TokenVelocityChart:
                       rank in pl-4 pr-0, Token cell pl-3 pr-4, value
                       cell px-4. Keeps the two cards visually flush
                       when rendered side-by-side. */}
                  <th
                    scope="col"
                    className="pl-4 pr-0 py-2 text-left font-display text-label font-medium uppercase tracking-header text-muted"
                  >
                    #
                  </th>
                  <th
                    scope="col"
                    className="pl-3 pr-4 py-2 text-left font-display text-label font-medium uppercase tracking-header text-muted"
                  >
                    Token
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-right font-display text-label font-medium uppercase tracking-header text-muted"
                  >
                    Volume
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t, i) => {
                  const name = t.meta.name ?? t.currencyDisplay;
                  const vol =
                    period === "7d" ? t.metrics.volume7d : t.metrics.volume24h;
                  const barPct = vol != null ? (vol / maxVolume) * 100 : 0;
                  return (
                    <tr
                      key={`${t.currency}-${t.issuer}`}
                      className="border-b border-elevated last:border-b-0"
                    >
                      <td className="pl-4 pr-0 py-2.5 font-mono text-cell text-muted">
                        {i + 1}
                      </td>
                      <td className="pl-3 pr-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {t.meta.icon && (
                            <Image
                              src={t.meta.icon}
                              alt=""
                              width={20}
                              height={20}
                              className="h-5 w-5 rounded-full"
                              unoptimized
                            />
                          )}
                          <div className="min-w-0">
                            <span className="font-mono text-cell font-medium text-primary">
                              {name}
                            </span>
                            {t.meta.issuerName && (
                              <span className="ml-1.5 font-mono text-label text-muted">
                                {t.meta.issuerName}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="relative px-4 py-2.5 text-right">
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 right-0 bg-brand/10"
                          style={{ width: `${barPct}%` }}
                        />
                        <span className="relative font-mono text-cell font-medium tabular-nums text-primary">
                          {vol != null ? formatXrp(vol) : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-3 font-mono text-body text-muted">—</p>
        )}
      </div>
    </div>
  );
}
