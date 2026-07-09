"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";

interface CorrelationResponse {
  matrix: number[][];
  tokens: string[];
}

function cellColor(value: number): string {
  // -1 (red) → 0 (neutral) → +1 (green)
  if (value >= 0) {
    const intensity = Math.min(value, 1);
    return `rgba(34, 197, 94, ${intensity * 0.5})`;
  }
  const intensity = Math.min(Math.abs(value), 1);
  return `rgba(239, 68, 68, ${intensity * 0.5})`;
}

export default function CorrelationMatrix() {
  const { data } = useSWR<CorrelationResponse>(
    "/api/portfolio/correlation",
    fetcher,
  );

  if (!data || data.matrix.length < 2) return null;

  const { matrix, tokens } = data;

  return (
    <div className="flex flex-col rounded-2xl shadow-card bg-surface">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Correlation (90d)
        </span>
      </div>

      <div className="overflow-x-auto px-4 py-4">
        <table className="w-full">
          <thead>
            <tr>
              <th scope="col" className="px-1 py-1" />
              {tokens.map((t) => (
                <th
                  key={t}
                  scope="col"
                  className="px-1 py-1 text-center font-mono text-tag font-medium text-muted"
                >
                  <span className="block max-w-[60px] truncate">{t}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={tokens[i]}>
                <th
                  scope="row"
                  className="px-1 py-1 text-right font-mono text-tag font-medium text-muted"
                >
                  <span className="block max-w-[60px] truncate text-right">
                    {tokens[i]}
                  </span>
                </th>
                {row.map((val, j) => (
                  <td key={j} className="px-1 py-1 text-center">
                    <div
                      className="mx-auto flex h-8 w-full min-w-[40px] max-w-[60px] items-center justify-center rounded-sm font-mono text-tag font-medium tabular-nums text-primary"
                      style={{ backgroundColor: cellColor(val) }}
                      title={`${tokens[i]} × ${tokens[j]}: ${val.toFixed(2)}`}
                    >
                      {i === j ? "" : val.toFixed(2)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
