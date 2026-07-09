"use client";

import { useState } from "react";
import type { MarketingData } from "./types";
import { cn } from "@/lib/utils";

type SectionKey = Exclude<keyof MarketingData, "generatedAt" | "windowNotes">;

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "smartMoneyTop10", label: "Smart Money Top 10" },
  { key: "biggestTxs24h", label: "Biggest XRP Transactions (24h)" },
  { key: "topDexPairs7d", label: "Top DEX Pairs (7d)" },
  { key: "topLiquidityPools", label: "Top Liquidity Pools (AMM)" },
  { key: "topGainers24h", label: "Top Gainers (24h)" },
  { key: "activeAccountsTrend28d", label: "Active Accounts Trend (28d)" },
  { key: "trustlineWinners7d", label: "Trustline Growth Winners (7d)" },
  { key: "anomalies", label: "Network Anomalies" },
];

interface DataExportProps {
  data: MarketingData | null;
  loading: boolean;
  error: string | null;
  onFetch: () => void;
}

export function MarketingDataExport({ data, loading, error, onFetch }: DataExportProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function copySection(key: string, value: unknown) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Clipboard API may fail in insecure contexts — silently ignore,
      // user can manually select from the pre block instead.
    }
  }

  return (
    <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 font-display text-label font-medium uppercase tracking-header text-muted">
            Data Export
          </p>
          <p className="font-body text-ui text-secondary">
            Pull fresh marketing-ready data from Postgres + ClickHouse. Populates
            the card previews above and shows raw JSON below.
          </p>
        </div>
        <button
          type="button"
          onClick={onFetch}
          disabled={loading}
          className={cn(
            "shrink-0 rounded-lg border border-brand bg-brand/10 px-4 py-2 font-mono text-label font-medium uppercase tracking-pill text-brand transition-all",
            "hover:bg-brand/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
            loading && "cursor-wait opacity-60",
          )}
        >
          {loading ? "Running…" : "Run Export"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-error/30 bg-error/10 px-4 py-3 font-mono text-label text-error"
        >
          Export failed: {error}
        </div>
      )}

      {data && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-elevated pb-3">
            <span className="font-mono text-label text-muted">
              Generated {new Date(data.generatedAt).toLocaleString()}
            </span>
            <span className="font-mono text-label text-warning">
              {data.windowNotes}
            </span>
          </div>
          <div className="space-y-3">
            {SECTIONS.map((section) => {
              const value = data[section.key];
              const count = Array.isArray(value) ? value.length : 0;
              const isCopied = copiedKey === section.key;
              const isEmpty = count === 0;
              return (
                <details
                  key={section.key}
                  className="group rounded-lg border border-elevated bg-background"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
                    <span className="font-display text-label font-medium uppercase tracking-header text-muted group-open:text-primary">
                      {section.label}{" "}
                      <span
                        className={cn(
                          isEmpty ? "text-muted" : "text-brand",
                        )}
                      >
                        ({count})
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        void copySection(section.key, value);
                      }}
                      disabled={isEmpty}
                      className={cn(
                        "rounded px-2 py-0.5 font-mono text-label uppercase tracking-pill transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                        isEmpty
                          ? "cursor-not-allowed text-muted opacity-50"
                          : "text-muted hover:bg-elevated hover:text-primary",
                      )}
                    >
                      {isCopied ? "Copied!" : "Copy JSON"}
                    </button>
                  </summary>
                  <pre className="overflow-x-auto border-t border-elevated px-4 py-3 font-mono text-cell text-secondary">
                    {isEmpty
                      ? "// No rows returned. ClickHouse may be unreachable or the time window has no matching data."
                      : JSON.stringify(value, null, 2)}
                  </pre>
                </details>
              );
            })}
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <p className="font-mono text-label text-muted">
          Click &ldquo;Run Export&rdquo; to pull the current snapshot and populate the cards above.
        </p>
      )}
    </div>
  );
}

export default MarketingDataExport;
