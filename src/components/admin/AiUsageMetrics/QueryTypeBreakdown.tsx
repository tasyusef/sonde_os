"use client";

import type { ByQueryType } from "./types";
import { fmtNum, fmtUsdShort } from "./formatters";

const QUERY_TYPE_LABELS: Record<string, string> = {
  intel_query: "Intel Query",
  investigation: "Investigation",
  portfolio_query: "Portfolio Query",
};

export default function QueryTypeBreakdown({
  byQueryType,
  loading,
}: {
  byQueryType: ByQueryType[];
  loading: boolean;
}) {
  return (
    <div className="mb-6 rounded-2xl border border-elevated bg-surface shadow-card">
      <p className="border-b border-elevated px-5 py-4 font-display text-label font-bold uppercase tracking-header text-brand">
        By Query Type
      </p>
      {byQueryType.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center">
          <p className="font-mono text-body text-muted">
            {loading ? "Loading..." : "No data this month"}
          </p>
        </div>
      ) : (
        <>
          {/* Table layout — lg+ */}
          <table className="hidden w-full lg:table">
            <thead>
              <tr>
                {["Type", "Count", "Avg In", "Avg Out", "Avg Cost", "Total Cost"].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`px-5 py-2 font-display text-label font-medium uppercase tracking-header text-muted ${i === 0 ? "text-left" : "text-right"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byQueryType.map((row) => (
                <tr key={row.queryType} className="border-b border-elevated last:border-b-0">
                  <td className="px-5 py-3 font-mono text-cell text-primary">
                    {QUERY_TYPE_LABELS[row.queryType] ?? row.queryType}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-cell tabular-nums text-primary">{fmtNum(row.count)}</td>
                  <td className="px-5 py-3 text-right font-mono text-cell tabular-nums text-muted">{fmtNum(row.avgTokensIn)}</td>
                  <td className="px-5 py-3 text-right font-mono text-cell tabular-nums text-muted">{fmtNum(row.avgTokensOut)}</td>
                  <td className="px-5 py-3 text-right font-mono text-cell tabular-nums text-muted">{fmtUsdShort(row.avgCostUsd)}</td>
                  <td className="px-5 py-3 text-right font-mono text-cell tabular-nums text-primary">{fmtUsdShort(row.totalCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Stacked card layout — mobile / tablet */}
          <div className="divide-y divide-elevated lg:hidden">
            {byQueryType.map((row) => (
              <div key={row.queryType} className="px-5 py-5">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-display text-ui font-semibold text-primary">
                      {QUERY_TYPE_LABELS[row.queryType] ?? row.queryType}
                    </p>
                    <p className="mt-0.5 font-display text-label uppercase tracking-header text-muted">
                      {fmtNum(row.count)} calls this month
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-label uppercase tracking-header text-muted">Total</p>
                    <p className="mt-0.5 font-mono text-value font-medium tabular-nums text-primary">
                      {fmtUsdShort(row.totalCostUsd)}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 divide-x divide-elevated rounded-lg border border-elevated">
                  {[
                    { label: "Avg In", value: fmtNum(row.avgTokensIn) },
                    { label: "Avg Out", value: fmtNum(row.avgTokensOut) },
                    { label: "Avg Cost", value: fmtUsdShort(row.avgCostUsd) },
                  ].map(({ label, value }) => (
                    <div key={label} className="px-3 py-2">
                      <p className="font-display text-label uppercase tracking-header text-muted">{label}</p>
                      <p className="mt-0.5 font-mono text-cell tabular-nums text-primary">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
