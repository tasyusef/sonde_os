"use client";

import { useState, useId, useMemo } from "react";
import useSWR from "swr";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { motion } from "motion/react";
import { SondeMark, SondeWordmark } from "@/components/shared/SondeLogo";
import AddressLink from "@/components/shared/AddressLink";
import { cn } from "@/lib/utils";
import { formatCompactNumber } from "@/lib/xrpl-helpers";
import { CACHE_KEYS } from "@/lib/swr-config";
import type { HolderData, HolderHistoryPoint } from "@/types/token";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const LINE_COLORS = [
  "var(--color-brand)",       // salmon
  "var(--color-tx-payment)",  // blue
  "var(--color-tx-nft)",      // purple
  "var(--color-tx-trust)",    // green
  "var(--color-tx-amm)",      // pink
  "var(--color-tx-offer)",    // amber
  "var(--color-tx-escrow)",   // orange
  "var(--color-tx-check)",    // red
  "var(--color-tx-account)",  // slate
  "var(--color-success)",     // success green
];

type ViewMode = "percent" | "tokens";
type Period = "7d" | "30d" | "90d";

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: "percent", label: "% Supply" },
  { value: "tokens", label: "Tokens" },
];

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

/* ------------------------------------------------------------------ */
/*  Chart data transform                                               */
/* ------------------------------------------------------------------ */

interface ChartRow {
  time: number;
  label: string;
  [address: string]: number | string;
}

function buildChartData(
  history: HolderHistoryPoint[],
  addresses: string[],
  mode: ViewMode,
): ChartRow[] {
  return history.map((point) => {
    const row: ChartRow = {
      time: new Date(point.time).getTime(),
      label: new Date(point.time).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    };
    const supply = point.holders[0]?.totalSupply || 1;

    for (const addr of addresses) {
      const holder = point.holders.find((h) => h.address === addr);
      if (holder) {
        row[addr] =
          mode === "percent"
            ? parseFloat(((holder.balance / supply) * 100).toFixed(2))
            : holder.balance;
      } else {
        row[addr] = 0;
      }
    }
    return row;
  });
}

/* ------------------------------------------------------------------ */
/*  Custom tooltip                                                     */
/* ------------------------------------------------------------------ */

function ChartTooltip({
  active,
  payload,
  label,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
  mode: ViewMode;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="max-w-[240px] rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="mb-1.5 font-mono text-label text-muted">{label}</p>
      {payload
        .filter((p) => (p.value as number) > 0)
        .slice(0, 5)
        .map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="font-mono text-label text-secondary">
                {p.dataKey.slice(0, 4)}...{p.dataKey.slice(-4)}
              </span>
            </span>
            <span className="font-mono text-label font-medium text-primary tabular-nums">
              {mode === "percent"
                ? `${p.value.toFixed(2)}%`
                : formatCompactNumber(p.value)}
            </span>
          </div>
        ))}
      {payload.filter((p) => p.value > 0).length > 5 && (
        <p className="mt-1 font-mono text-label text-muted">
          +{payload.filter((p) => p.value > 0).length - 5} more
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

interface TokenHoldersProps {
  data: HolderData;
  currency: string;
  issuer: string;
  currencyDisplay: string;
}

export default function TokenHolders({
  data: initialData,
  currency,
  issuer,
}: TokenHoldersProps) {
  const id = useId();
  const [mode, setMode] = useState<ViewMode>("percent");
  const [period, setPeriod] = useState<Period>("30d");

  const { data: swrData, isValidating } = useSWR<HolderData>(
    CACHE_KEYS.tokenHolders(currency, issuer, period),
    { fallbackData: initialData },
  );

  const data = swrData ?? initialData;

  const currentHolders = data.current?.holders;
  const holders = useMemo(
    () => currentHolders ?? [],
    [currentHolders],
  );

  // All unique addresses across current + history for consistent chart lines
  const allAddresses = useMemo(() => {
    const set = new Set<string>();
    for (const h of holders) set.add(h.address);
    for (const pt of data.history) {
      for (const h of pt.holders) set.add(h.address);
    }
    // Sort by current rank so lines are consistent
    const sorted = [...set].sort((a, b) => {
      const ra = holders.find((h) => h.address === a)?.rank ?? 99;
      const rb = holders.find((h) => h.address === b)?.rank ?? 99;
      return ra - rb;
    });
    return sorted.slice(0, 10);
  }, [holders, data.history]);

  const chartData = useMemo(
    () => buildChartData(data.history, allAddresses, mode),
    [data.history, allAddresses, mode],
  );

  // Compute "Rest" — total supply minus top 10
  const totalSupply = holders[0]?.totalSupply ?? 0;
  const top10Total = holders.reduce((sum, h) => sum + h.balance, 0);
  const restBalance = Math.max(0, totalSupply - top10Total);

  return (
    <div className="flex max-h-[700px] flex-col overflow-hidden rounded-2xl bg-surface shadow-card">
      {/* Header with toggles */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Top Holders
        </span>
        <div className="flex items-center gap-2">
          <PillToggle
            options={PERIOD_OPTIONS}
            active={period}
            onChange={setPeriod}
            id={`period-${id}`}
          />
          {isValidating && (
            <span className="font-mono text-label text-muted animate-pulse">
              ...
            </span>
          )}
          <PillToggle
            options={VIEW_OPTIONS}
            active={mode}
            onChange={setMode}
            id={`mode-${id}`}
          />
        </div>
      </div>

        {/* Chart — explicit height on mobile since the card isn't forced to
             stretch there; on lg+ it's stretched equal to the Orderbook via
             the parent grid's `items-stretch`, so flex-1 gets real height. */}
        {chartData.length >= 2 ? (
          <div className="relative h-[220px] border-b border-elevated px-4 py-4 lg:h-auto lg:min-h-0 lg:flex-1">
            <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center text-primary opacity-[0.03]">
              <div className="flex items-center gap-3">
                <SondeMark size={48} />
                <SondeWordmark height={36} />
              </div>
            </div>
            <div className="relative h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <XAxis
                    dataKey="label"
                    tick={{
                      fill: "var(--color-muted)",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                    }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) =>
                      mode === "percent"
                        ? `${v.toFixed(0)}%`
                        : formatCompactNumber(v)
                    }
                    tick={{
                      fill: "var(--color-muted)",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={4}
                    mirror
                  />
                  <Tooltip
                    content={<ChartTooltip mode={mode} />}
                    cursor={{
                      stroke: "var(--color-muted)",
                      strokeDasharray: "4 4",
                    }}
                  />
                  {allAddresses.map((addr, i) => (
                    <Line
                      key={addr}
                      type="monotone"
                      dataKey={addr}
                      stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="flex h-[120px] items-center justify-center border-b border-elevated">
            <p className="font-mono text-body text-muted">
              Tracking started — more data points coming
            </p>
          </div>
        )}

        {/* Holders — two columns of 5 */}
        <div className="overflow-y-auto">
          <div className="grid grid-cols-2 divide-x divide-elevated">
            {[holders.slice(0, 5), holders.slice(5, 10)].map(
              (column, colIdx) => (
                <div key={colIdx}>
                  {column.map((h, i) => {
                    const globalIdx = colIdx * 5 + i;
                    const pct =
                      totalSupply > 0
                        ? ((h.balance / totalSupply) * 100).toFixed(2)
                        : "0.00";
                    return (
                      <div
                        key={h.address}
                        className="flex items-center gap-2 border-b border-elevated px-3 py-row-compact last:border-b-0"
                      >
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              LINE_COLORS[globalIdx % LINE_COLORS.length],
                          }}
                        />
                        <span className="w-4 shrink-0 font-mono text-cell text-muted">
                          {h.rank}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <AddressLink address={h.address} />
                        </span>
                        <span className="shrink-0 font-mono text-cell font-medium text-secondary tabular-nums">
                          {mode === "percent"
                            ? `${pct}%`
                            : formatCompactNumber(h.balance)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ),
            )}
          </div>
          {restBalance > 0 && totalSupply > 0 && (
            <div className="flex items-center justify-between border-t border-elevated px-3 py-row-compact">
              <span className="font-mono text-cell text-muted">
                All Other Holders
              </span>
              <span className="font-mono text-cell font-medium text-secondary tabular-nums">
                {mode === "percent"
                  ? `${((restBalance / totalSupply) * 100).toFixed(2)}%`
                  : formatCompactNumber(restBalance)}
              </span>
            </div>
          )}
        </div>

        {/* Snapshot time footer */}
        {data.current?.snapshotTime && (
          <div className="border-t border-elevated px-4 py-2">
            <p className="font-mono text-label text-muted">
              Last snapshot:{" "}
              {new Date(data.current.snapshotTime).toLocaleString()}
            </p>
          </div>
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pill toggle (reusable within this file)                            */
/* ------------------------------------------------------------------ */

function PillToggle<T extends string>({
  options,
  active,
  onChange,
  id,
}: {
  options: Array<{ value: T; label: string }>;
  active: T;
  onChange: (value: T) => void;
  id: string;
}) {
  return (
    <div className="flex items-center rounded-full border border-elevated bg-elevated p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={active === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "relative whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-label font-medium uppercase tracking-pill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
            active === opt.value
              ? "text-brand"
              : "text-muted hover:text-secondary",
          )}
        >
          {active === opt.value && (
            <motion.div
              layoutId={`pill-bg-${id}`}
              className="absolute inset-0 rounded-full bg-surface shadow-sm"
              transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
            />
          )}
          <span className="relative z-10">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

export { TokenHolders };
