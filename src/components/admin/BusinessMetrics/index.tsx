"use client";

import { useId } from "react";
import useSWR from "swr";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import StatCard from "@/components/shared/StatCard";
import { fetcher } from "@/lib/swr-config";
import { CHART_CHROME } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TierBreakdown {
  tier: string;
  count: number;
}

interface SignupPoint {
  date: string;
  signups: number;
}

interface BusinessData {
  totalUsers: number;
  mrr: number;
  churnThisMonth: number;
  aiQueriesThisMonth: number;
  tierBreakdown: TierBreakdown[];
  signups: SignupPoint[];
}

// Poll every 30s so the admin dashboard reflects recent queries/signups
// without requiring a manual refresh.
const ADMIN_SWR_OPTIONS = {
  refreshInterval: 30_000,
  revalidateOnFocus: true,
  dedupingInterval: 5_000,
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COLORS = CHART_CHROME;

const TIER_COLORS: Record<string, string> = {
  free: COLORS.muted,
  pro: COLORS.brand,
};

const TICK_BOX: React.CSSProperties = {
  padding: "1px 6px",
  borderRadius: 3,
  background: "color-mix(in srgb, var(--color-surface) 75%, transparent)",
  fontSize: "var(--text-label)",
  fontFamily: "var(--font-mono)",
  color: "var(--color-muted)",
  lineHeight: "18px",
  whiteSpace: "nowrap",
};

/* ------------------------------------------------------------------ */
/*  Formatters                                                         */
/* ------------------------------------------------------------------ */

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Tick renderers                                                     */
/* ------------------------------------------------------------------ */

interface TickProps {
  x?: string | number;
  y?: string | number;
  payload?: { value: string | number };
}

function YTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject
      x={Number(x) + 4}
      y={Number(y) - 10}
      width={80}
      height={20}
      style={{ overflow: "visible" }}
    >
      <span style={{ ...TICK_BOX, display: "inline-block" }}>
        {fmtNum(Number(payload.value))}
      </span>
    </foreignObject>
  );
}

function XTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject
      x={Number(x) - 40}
      y={Number(y) + 4}
      width={80}
      height={20}
      style={{ overflow: "visible" }}
    >
      <span style={{ ...TICK_BOX, display: "block", textAlign: "center" }}>
        {fmtDate(String(payload.value))}
      </span>
    </foreignObject>
  );
}

/* ------------------------------------------------------------------ */
/*  Donut center label                                                 */
/* ------------------------------------------------------------------ */

function DonutCenter({ totalUsers }: { totalUsers: number }) {
  return (
    <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central">
      <tspan
        x="50%"
        dy="-0.4em"
        style={{
          fill: "var(--color-primary)",
          fontSize: "var(--text-value)",
          fontFamily: "var(--font-mono)",
          fontWeight: 500,
        }}
      >
        {fmtNum(totalUsers)}
      </tspan>
      <tspan
        x="50%"
        dy="1.4em"
        style={{
          fill: "var(--color-muted)",
          fontSize: "var(--text-label)",
          fontFamily: "var(--font-mono)",
        }}
      >
        users
      </tspan>
    </text>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function BusinessMetrics() {
  const signupsGradientId = useId();

  const { data, isLoading, isValidating } = useSWR<BusinessData>(
    "/api/admin/business",
    fetcher,
    ADMIN_SWR_OPTIONS,
  );

  const loading = isLoading || isValidating;
  const tierBreakdown = data?.tierBreakdown ?? [];
  const signups = data?.signups ?? [];
  const totalUsers = data?.totalUsers ?? 0;

  return (
    <section>
      <h2 className="mb-4 font-display text-heading font-semibold text-primary">
        Business Metrics
      </h2>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Users" value={fmtNum(totalUsers)} />
        <StatCard label="MRR" value={fmtUsd(data?.mrr ?? 0)} />
        <StatCard label="Churn This Month" value={data?.churnThisMonth ?? 0} />
        <StatCard
          label="AI Queries This Month"
          value={fmtNum(data?.aiQueriesThisMonth ?? 0)}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Tier donut */}
        <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
          <p className="mb-3 font-display text-label font-bold uppercase tracking-header text-brand">
            Users by Tier
          </p>
          <div
            className={cn(
              "transition-opacity",
              loading ? "opacity-40" : "opacity-100",
            )}
          >
            {tierBreakdown.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center">
                <p className="font-mono text-body text-muted">
                  {loading ? "Loading..." : "No data"}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={tierBreakdown}
                      dataKey="count"
                      nameKey="tier"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      strokeWidth={0}
                    >
                      {tierBreakdown.map((entry) => (
                        <Cell
                          key={entry.tier}
                          fill={TIER_COLORS[entry.tier] ?? COLORS.muted}
                        />
                      ))}
                    </Pie>
                    {/* Center label rendered as raw SVG */}
                    <DonutCenter totalUsers={totalUsers} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload as TierBreakdown;
                        return (
                          <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                            <p className="font-mono text-label text-muted">
                              {d.tier}
                            </p>
                            <p className="font-mono text-value font-medium text-primary">
                              {fmtNum(d.count)} users
                            </p>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div className="mt-2 flex gap-4">
                  {tierBreakdown.map((entry) => (
                    <div key={entry.tier} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor:
                            TIER_COLORS[entry.tier] ?? COLORS.muted,
                        }}
                      />
                      <span className="font-mono text-label text-muted">
                        {entry.tier}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Signups over time */}
        <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
          <p className="mb-3 font-display text-label font-bold uppercase tracking-header text-brand">
            Signups (Last 30 Days)
          </p>
          <div
            className={cn(
              "transition-opacity",
              loading ? "opacity-40" : "opacity-100",
            )}
          >
            {signups.length < 2 ? (
              <div className="flex h-[220px] items-center justify-center">
                <p className="font-mono text-body text-muted">
                  {loading ? "Loading..." : "No data"}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart
                  data={signups}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient
                      id={signupsGradientId}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={COLORS.brand}
                        stopOpacity={0.2}
                      />
                      <stop
                        offset="100%"
                        stopColor={COLORS.brand}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    horizontal
                    vertical={false}
                    stroke={COLORS.elevated}
                  />
                  <XAxis
                    dataKey="date"
                    tick={(props: TickProps) => <XTick {...props} />}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={60}
                  />
                  <YAxis
                    tick={(props: TickProps) => <YTick {...props} />}
                    axisLine={false}
                    tickLine={false}
                    width={4}
                    mirror
                    allowDecimals={false}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as SignupPoint;
                      return (
                        <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                          <p className="font-mono text-label text-muted">
                            {fmtDate(d.date)}
                          </p>
                          <p className="font-mono text-value font-medium text-primary">
                            {d.signups} signups
                          </p>
                        </div>
                      );
                    }}
                    cursor={{
                      stroke: COLORS.muted,
                      strokeWidth: 1,
                      strokeDasharray: "4 4",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="signups"
                    stroke={COLORS.brand}
                    strokeWidth={2}
                    fill={`url(#${signupsGradientId})`}
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: COLORS.brand,
                      stroke: COLORS.surface,
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default BusinessMetrics;
