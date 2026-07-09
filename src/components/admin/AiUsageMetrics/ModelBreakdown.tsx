"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { MULTI_SERIES_PALETTE } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import type { ByModel } from "./types";
import { fmtModelName, fmtNum, fmtUsdShort } from "./formatters";

export default function ModelBreakdown({ byModel, loading }: { byModel: ByModel[]; loading: boolean }) {
  return (
    <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
      <p className="mb-3 font-display text-label font-bold uppercase tracking-header text-brand">
        Queries by Model
      </p>
      <div className={cn("transition-opacity", loading ? "opacity-40" : "opacity-100")}>
        {byModel.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center">
            <p className="font-mono text-body text-muted">{loading ? "Loading..." : "No data"}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={byModel}
                  dataKey="count"
                  nameKey="model"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  strokeWidth={0}
                >
                  {byModel.map((entry, i) => (
                    <Cell key={entry.model ?? "legacy"} fill={MULTI_SERIES_PALETTE[i % MULTI_SERIES_PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as ByModel;
                    return (
                      <div className="rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
                        <p className="font-mono text-label text-muted">{fmtModelName(d.model)}</p>
                        <p className="font-mono text-value font-medium text-primary">{fmtNum(d.count)} queries</p>
                        <p className="font-mono text-label text-muted">{fmtUsdShort(d.totalCostUsd)} total</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Legend */}
            <div className="mt-2 flex flex-wrap justify-center gap-4">
              {byModel.map((entry, i) => (
                <div key={entry.model ?? "legacy"} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: MULTI_SERIES_PALETTE[i % MULTI_SERIES_PALETTE.length] }}
                  />
                  <span className="font-mono text-label text-muted">{fmtModelName(entry.model)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
