"use client";

import Link from "next/link";
import useSWR from "swr";
import CollapsibleCard from "@/components/shared/CollapsibleCard";
import { cn } from "@/lib/utils";

// Note: stale `gateway` rows may exist in account_labels from before the
// label was retired (2026-04-30 with the Neo4j removal). They render as
// nothing (display map lookup misses + null return below) — fine, no
// crash. Cleaned up in a follow-up migration if anyone notices.
const LABEL_DISPLAY: Record<string, { name: string; colorClass: string }> = {
  profitable_trader: { name: "Profitable Trader", colorClass: "bg-success/10 text-success" },
  market_maker: { name: "Market Maker", colorClass: "bg-tx-offer/10 text-tx-offer" },
  early_lp: { name: "Early LP", colorClass: "bg-tx-amm/10 text-tx-amm" },
  whale: { name: "Whale", colorClass: "bg-brand/10 text-brand" },
  validator: { name: "Validator", colorClass: "bg-chart-emerald/10 text-chart-emerald" },
};

interface LabelData {
  label: string;
  confidence: number;
}

interface LabelsResponse {
  labels: LabelData[];
}

interface ScoreResponse {
  compositeScore: number;
}

// Score tier thresholds calibrated against the recalibrated curves.
// Top wallet on the new model scores ~64; p95 ≈ 42; p90 ≈ 32. Old
// `>=80 / >=60` thresholds came from the pre-recalibration era when
// hitting 80 was easy and almost meaningless. New: 50+ = top ~5% =
// "Smart Money", 30+ = top ~12% = "Emerging".
function scoreColor(score: number): string {
  if (score >= 50) return "text-success";
  if (score >= 30) return "text-brand";
  return "text-muted";
}

function scoreTier(score: number): string {
  if (score >= 50) return "Smart Money";
  if (score >= 30) return "Emerging";
  return "";
}

export default function SmartMoneyBadges({ address }: { address: string }) {
  const { data } = useSWR<LabelsResponse>(
    `/api/intel/labels?account=${address}`,
    (url: string) => fetch(url).then((r) => r.ok ? r.json() : null),
    { dedupingInterval: 60_000, keepPreviousData: true },
  );

  // Also fetch composite score — silently fails for free users on non-#1 wallets
  const { data: scoreData } = useSWR<ScoreResponse>(
    `/api/smart-money/${address}`,
    (url: string) => fetch(url).then((r) => r.ok ? r.json() : null),
    { dedupingInterval: 60_000, keepPreviousData: true },
  );

  const labels = data?.labels ?? [];
  const score = scoreData?.compositeScore;
  const hasScore = typeof score === "number" && score > 0;

  if (labels.length === 0 && !hasScore) return null;

  return (
    <CollapsibleCard title="Smart Money" storageKey="smart-money">
      <div className="px-4 py-4">
        {/* Composite score badge — links to detail page */}
        {hasScore && (
          <Link
            href={`/smart-money/${address}`}
            className="mb-2 flex items-center gap-2 rounded-xl bg-elevated px-3 py-2 transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <span className={cn("font-mono text-value font-bold", scoreColor(score))}>
              {score.toFixed(0)}
            </span>
            {scoreTier(score) && (
              <span className={cn("font-mono text-label font-medium", scoreColor(score))}>
                {scoreTier(score)}
              </span>
            )}
            <span className="ml-auto font-mono text-tag text-muted">View details &rarr;</span>
          </Link>
        )}

        {/* Label badges */}
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l) => {
              const display = LABEL_DISPLAY[l.label];
              if (!display) return null;
              return (
                <span
                  key={l.label}
                  className={`rounded-full px-2 py-0.5 font-mono text-label font-semibold ${display.colorClass}`}
                  title={`Confidence: ${(l.confidence * 100).toFixed(0)}%`}
                >
                  {display.name}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}
