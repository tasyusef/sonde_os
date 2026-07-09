"use client";

import { useState, useId } from "react";
import useSWR from "swr";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import Toggle from "@/components/shared/Toggle";
import DropdownMenu from "@/components/shared/DropdownMenu";
import StatCard from "@/components/shared/StatCard";
import { fetcher } from "@/lib/swr-config";
import { CHART_CHROME } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Period = "7d" | "30d" | "90d";

interface DailyPoint {
  date: string;
  views: number;
  uniques: number;
}

interface PageStat {
  route_pattern: string;
  views: number;
}

interface ReferrerStat {
  referrer_host: string;
  views: number;
  uniques: number;
}

interface AnalyticsData {
  dailyViews: DailyPoint[];
  topPages: PageStat[];
  topReferrers: ReferrerStat[];
  today: { views: number; uniques: number };
  yesterday: { views: number; uniques: number };
  routePatterns: string[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

const COLORS = CHART_CHROME;

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

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Tick renderers (foreignObject pattern)                             */
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
/*  Custom tooltip                                                     */
/* ------------------------------------------------------------------ */

function ChartTooltip({
  active,
  payload,
  labelKey,
  valueKeys,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
  labelKey: string;
  valueKeys: { key: string; label: string; color?: string }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-label text-muted">
        {labelKey === "date" ? fmtDate(String(d[labelKey])) : String(d[labelKey])}
      </p>
      {valueKeys.map((vk) => (
        <p
          key={vk.key}
          className="font-mono text-value font-medium text-primary"
          style={vk.color ? { color: vk.color } : undefined}
        >
          {fmtNum(Number(d[vk.key]))} {vk.label}
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function SiteAnalytics() {
  const viewsGradientId = useId();
  const uniquesGradientId = useId();
  const [period, setPeriod] = useState<Period>("7d");
  const [routeFilter, setRouteFilter] = useState<string>("");

  const daysMap: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 };
  const { data, isLoading, isValidating } = useSWR<AnalyticsData>(
    `/api/admin/analytics?days=${daysMap[period]}`,
    fetcher,
    { dedupingInterval: 30_000, revalidateOnFocus: true },
  );

  const loading = isLoading || isValidating;
  const daily = data?.dailyViews ?? [];
  const topPages = (data?.topPages ?? []).slice(0, 15);
  const topReferrers = (data?.topReferrers ?? []).slice(0, 10);
  const routes = data?.routePatterns ?? [];
  const topPage = topPages.length > 0 ? topPages[0].route_pattern : "---";

  const filteredDaily = daily;

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-heading font-semibold text-primary">
          Site Analytics
        </h2>
        <div className="w-fit">
          <Toggle options={PERIODS} active={period} onChange={setPeriod} />
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Views Today" value={fmtNum(data?.today?.views ?? 0)} />
        <StatCard label="Uniques Today" value={fmtNum(data?.today?.uniques ?? 0)} />
        <StatCard label="Top Page" value={topPage} />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Daily page views */}
        <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
          <p className="mb-3 font-display text-label font-medium uppercase tracking-header text-muted">
            Daily Page Views
          </p>
          <div
            className={cn(
              "transition-opacity",
              loading ? "opacity-40" : "opacity-100",
            )}
          >
            {daily.length < 2 ? (
              <div className="flex h-[220px] items-center justify-center">
                <p className="font-mono text-body text-muted">
                  {loading ? "Loading..." : "No data"}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart
                  data={filteredDaily}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient
                      id={viewsGradientId}
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
                  />
                  <Tooltip
                    content={({ active, payload }) => (
                      <ChartTooltip
                        active={active}
                        payload={
                          payload as unknown as Array<{
                            payload: Record<string, unknown>;
                          }>
                        }
                        labelKey="date"
                        valueKeys={[{ key: "views", label: "views" }]}
                      />
                    )}
                    cursor={{
                      stroke: COLORS.muted,
                      strokeWidth: 1,
                      strokeDasharray: "4 4",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="views"
                    stroke={COLORS.brand}
                    strokeWidth={2}
                    fill={`url(#${viewsGradientId})`}
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

        {/* Daily unique visitors */}
        <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
          <p className="mb-3 font-display text-label font-medium uppercase tracking-header text-muted">
            Daily Unique Visitors
          </p>
          <div
            className={cn(
              "transition-opacity",
              loading ? "opacity-40" : "opacity-100",
            )}
          >
            {daily.length < 2 ? (
              <div className="flex h-[220px] items-center justify-center">
                <p className="font-mono text-body text-muted">
                  {loading ? "Loading..." : "No data"}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart
                  data={daily}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient
                      id={uniquesGradientId}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--color-chart-emerald)"
                        stopOpacity={0.2}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--color-chart-emerald)"
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
                  />
                  <Tooltip
                    content={({ active, payload }) => (
                      <ChartTooltip
                        active={active}
                        payload={
                          payload as unknown as Array<{
                            payload: Record<string, unknown>;
                          }>
                        }
                        labelKey="date"
                        valueKeys={[
                          {
                            key: "uniques",
                            label: "uniques",
                            color: "var(--color-chart-emerald)",
                          },
                        ]}
                      />
                    )}
                    cursor={{
                      stroke: COLORS.muted,
                      strokeWidth: 1,
                      strokeDasharray: "4 4",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="uniques"
                    stroke="var(--color-chart-emerald)"
                    strokeWidth={2}
                    fill={`url(#${uniquesGradientId})`}
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: "var(--color-chart-emerald)",
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

      {/* Top referrers + top pages — side-by-side on lg+ */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top referrers */}
        <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
          <p className="mb-3 font-display text-label font-medium uppercase tracking-header text-muted">
            Top Referrers (7d)
          </p>
          <div
            className={cn(
              "transition-opacity",
              loading ? "opacity-40" : "opacity-100",
            )}
          >
            {topReferrers.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center">
                <p className="font-mono text-body text-muted">
                  {loading
                    ? "Loading..."
                    : "No external referrers yet — most traffic is direct or hasn't been captured since the referrer column was added."}
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-elevated">
                    <th
                      scope="col"
                      className="pb-2 text-left font-display text-tag uppercase tracking-header text-muted"
                    >
                      Source
                    </th>
                    <th
                      scope="col"
                      className="pb-2 text-right font-display text-tag uppercase tracking-header text-muted"
                    >
                      Uniques
                    </th>
                    <th
                      scope="col"
                      className="pb-2 text-right font-display text-tag uppercase tracking-header text-muted"
                    >
                      Views
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topReferrers.map((r) => (
                    <tr
                      key={r.referrer_host}
                      className="border-b border-elevated last:border-b-0"
                    >
                      <td className="py-2 font-body text-cell text-primary">
                        {r.referrer_host}
                      </td>
                      <td className="py-2 text-right font-mono text-cell text-primary">
                        {fmtNum(r.uniques)}
                      </td>
                      <td className="py-2 text-right font-mono text-cell text-muted">
                        {fmtNum(r.views)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Top pages bar chart */}
        <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-display text-label font-medium uppercase tracking-header text-muted">
            Top Pages by Views
          </p>
          {routes.length > 0 && (
            <DropdownMenu
              triggerLabel={routeFilter || "All routes"}
              triggerClassName="w-full sm:w-auto"
              items={[
                { value: "", label: "All routes" },
                ...routes.map((r) => ({ value: r, label: r })),
              ]}
              selectedValue={routeFilter}
              onSelect={setRouteFilter}
              label="Filter by route pattern"
              align="right"
            />
          )}
        </div>
        <div
          className={cn(
            "transition-opacity",
            loading ? "opacity-40" : "opacity-100",
          )}
        >
          {topPages.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center">
              <p className="font-mono text-body text-muted">
                {loading ? "Loading..." : "No data"}
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, topPages.length * 40)}>
              <BarChart
                data={topPages}
                layout="vertical"
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                barCategoryGap={8}
              >
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="route_pattern" hide />
                <Tooltip
                  content={({ active, payload }) => (
                    <ChartTooltip
                      active={active}
                      payload={
                        payload as unknown as Array<{
                          payload: Record<string, unknown>;
                        }>
                      }
                      labelKey="route_pattern"
                      valueKeys={[{ key: "views", label: "views" }]}
                    />
                  )}
                  cursor={{
                    fill: "var(--color-elevated)",
                    opacity: 0.5,
                  }}
                />
                <Bar
                  dataKey="views"
                  fill={COLORS.brand}
                  radius={4}
                  background={{ fill: "var(--color-elevated)", radius: 4 }}
                >
                  <LabelList
                    dataKey="route_pattern"
                    position="insideLeft"
                    style={{
                      fill: "var(--color-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                    }}
                    offset={10}
                  />
                  <LabelList
                    dataKey="views"
                    position="insideRight"
                    formatter={(v: unknown) => fmtNum(Number(v))}
                    style={{
                      fill: "var(--color-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                    }}
                    offset={10}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        </div>
      </div>
    </section>
  );
}

export default SiteAnalytics;
