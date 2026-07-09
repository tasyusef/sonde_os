"use client";

import useSWR from "swr";
import Link from "next/link";
import InfoTip from "@/components/shared/InfoTip";
import { cn } from "@/lib/utils";

interface IssuerRecipient {
  address: string;
  amountReceived: number;
  paymentCount: number;
  isTopHolder: boolean;
  holderRank: number | null;
}

interface IssuerAnalysisData {
  recipientCount: number;
  topRecipients: IssuerRecipient[];
  insiderRatio: number;
  distributionGini: number;
  /** Total token supply — used to compute per-row "% of supply" and
   *  the aggregate top-N concentration metric. 0 if unavailable. */
  totalSupply: number;
  source?: "direct_payments" | "holders_snapshot" | "none";
  status: "scored" | "insufficient_data" | "unavailable";
}

/** Compact human-readable number formatter. Handles up to quadrillions
 * — token supplies on XRPL routinely cross trillions, and the previous
 * version fell through to engineering notation ("18.0E") for those. */
function formatAmount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000_000) return `${(n / 1_000_000_000_000_000).toFixed(1)}Q`;
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function fairnessLabel(gini: number): { label: string; color: string } {
  if (gini < 0.4) return { label: "Fair distribution", color: "text-success" };
  if (gini < 0.65) return { label: "Moderate concentration", color: "text-chart-amber" };
  return { label: "Highly concentrated", color: "text-error" };
}

export default function IssuerAnalysis({ currency, issuer }: { currency: string; issuer: string }) {
  const { data, isLoading } = useSWR<IssuerAnalysisData>(
    `/api/intel/issuer-analysis?currency=${encodeURIComponent(currency)}&issuer=${issuer}`,
    (url: string) => fetch(url).then((r) => r.ok ? r.json() : null),
    { dedupingInterval: 60_000, keepPreviousData: true },
  );

  if (isLoading && !data) {
    return (
      <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
        <h3 className="font-display text-label font-bold uppercase tracking-header text-brand mb-4">Issuer Distribution</h3>
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-brand" role="status" aria-label="Loading issuer analysis" />
        </div>
      </div>
    );
  }

  if (!data || data.status === "unavailable") return null;

  if (data.status === "insufficient_data") {
    return (
      <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
        <h3 className="font-display text-label font-bold uppercase tracking-header text-brand mb-4">Issuer Distribution</h3>
        <p className="py-4 text-center font-mono text-cell text-muted">
          Insufficient data — no direct-payment trail from issuer and no
          holder snapshot available yet.
        </p>
      </div>
    );
  }

  const fairness = fairnessLabel(data.distributionGini);
  const isSnapshotSource = data.source === "holders_snapshot";

  // Source-aware labels. Direct-payment data describes "who the issuer
  // paid"; holder-snapshot data describes "who currently holds". Keep the
  // metric labels truthful for each case.
  const sourceNote = isSnapshotSource
    ? "Derived from current top holders — this issuer distributes via AMM/DEX rather than direct payments."
    : "Derived from direct issuer → recipient payments on-ledger.";

  // Bars are scaled to the top recipient's amount. We show up to 10
  // rows; addresses below that are aggregated into the metrics above.
  const recipients = data.topRecipients.slice(0, 10);
  const maxAmount = Math.max(...recipients.map((r) => r.amountReceived), 1);

  // Aggregate concentration: what share of total supply does the top
  // 10 hold? Only meaningful when totalSupply is known. In direct-
  // payment mode the same math expresses "% of supply that flowed
  // through the top 10 recipients", which is informative either way.
  const top10Sum = recipients.reduce((s, r) => s + r.amountReceived, 0);
  const topShareValid = data.totalSupply > 0 && top10Sum <= data.totalSupply * 1.001; // tolerate float fuzz
  const topSharePct = topShareValid ? (top10Sum / data.totalSupply) * 100 : null;
  const topShareLabel = isSnapshotSource ? `Top ${recipients.length} Share` : `Top ${recipients.length} Received`;

  return (
    <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h3 className="font-display text-label font-bold uppercase tracking-header text-brand">Issuer Distribution</h3>
        <span
          className={cn(
            "shrink-0 rounded-tag px-2 py-0.5 font-display text-micro font-medium uppercase tracking-header",
            isSnapshotSource ? "bg-tx-amm/10 text-tx-amm" : "bg-tx-payment/10 text-tx-payment",
          )}
          title={sourceNote}
        >
          {/* "Snapshot" / "Direct" — disambiguates from the "Holders" stat
              below in snapshot mode (the stat is a count, the tag is a
              data-source signal). */}
          {isSnapshotSource ? "Snapshot" : "Direct"}
        </span>
      </div>

      {/* Stats row. Snapshot mode drops the redundant Recipients count
          (always ≤10 in that path, just confirms the row count below)
          and surfaces the more informative "Top N Share" instead.
          Direct-payment mode keeps the recipient total since it can be
          much larger than the displayed top-10 sample. */}
      <div
        className={cn(
          "mb-5 grid gap-4 grid-cols-2",
          isSnapshotSource ? "sm:grid-cols-3" : "sm:grid-cols-4",
        )}
      >
        {!isSnapshotSource && (
          <div>
            <p className="flex items-center gap-1 font-display text-tag text-muted uppercase tracking-header">
              Recipients
              <InfoTip>
                Total unique addresses that received this token directly from
                the issuer over its full history. The top {recipients.length}{" "}
                by amount are shown below.
              </InfoTip>
            </p>
            <p className="font-mono text-value text-primary tabular-nums">{data.recipientCount}</p>
          </div>
        )}
        {!isSnapshotSource && (
          <div>
            <p className="flex items-center gap-1 font-display text-tag text-muted uppercase tracking-header">
              Insider Ratio
              <InfoTip>
                Share of current top-10 holders who also received tokens
                directly from the issuer. High values often signal team
                allocations or insider airdrops.
              </InfoTip>
            </p>
            <p className="font-mono text-value text-primary tabular-nums">{(data.insiderRatio * 100).toFixed(0)}%</p>
          </div>
        )}
        {isSnapshotSource && topSharePct !== null && (
          <div>
            <p className="flex items-center gap-1 font-display text-tag text-muted uppercase tracking-header">
              {topShareLabel}
              <InfoTip>
                Share of total supply held by the top {recipients.length}{" "}
                addresses shown below. Higher means more concentration in
                fewer hands.
              </InfoTip>
            </p>
            <p className="font-mono text-value text-primary tabular-nums">{topSharePct.toFixed(1)}%</p>
          </div>
        )}
        <div>
          <p className="flex items-center gap-1 font-display text-tag text-muted uppercase tracking-header">
            Gini Index
            <InfoTip>
              Standard measure of inequality. <strong className="text-primary">0</strong>{" "}
              = everyone holds an equal slice; <strong className="text-primary">1</strong>{" "}
              = one wallet holds everything. Below{" "}
              <strong className="text-primary">0.4</strong> reads as fair,{" "}
              <strong className="text-primary">0.4–0.65</strong> moderate, above{" "}
              <strong className="text-primary">0.65</strong> highly concentrated.
            </InfoTip>
          </p>
          <p className="font-mono text-value text-primary tabular-nums">{data.distributionGini.toFixed(2)}</p>
        </div>
        {/* Assessment carries the longest text ("Highly concentrated"
            wraps in a 160px column on mobile). Span both mobile cells
            so it always reads on one line; revert to a single cell on
            sm+ where the stats sit on one row. */}
        <div className="col-span-2 sm:col-span-1">
          <p className="flex items-center gap-1 font-display text-tag text-muted uppercase tracking-header">
            Assessment
            <InfoTip>
              Plain-English read on the Gini score: Fair distribution (&lt;0.4),
              Moderate concentration (0.4–0.65), or Highly concentrated (&gt;0.65).
            </InfoTip>
          </p>
          <p className={cn("font-mono text-value font-semibold whitespace-nowrap", fairness.color)}>{fairness.label}</p>
        </div>
      </div>

      {/* Ranked recipient rows. The bar is the row's background fill
          (scales to the top recipient's amount), so visual ranking +
          numeric value + address all live in one row that scales
          naturally to any width. No per-row borders — the fill IS the
          structure; box outlines competed with it visually. */}
      <div className="divide-y divide-elevated/60">
        {recipients.map((r) => {
          const pct = (r.amountReceived / maxAmount) * 100;
          const supplyPct = data.totalSupply > 0 ? (r.amountReceived / data.totalSupply) * 100 : null;
          const showInsiderBadge = !isSnapshotSource && r.isTopHolder;
          return (
            <div key={r.address} className="relative isolate overflow-hidden">
              {/* Background fill — scales with amount, sits behind text.
                  Neutral brand tint regardless of data source: the bar
                  conveys magnitude only, the source signal lives in
                  the header tag. Earlier version flipped between pink
                  (tx-amm) and blue (tx-payment) which read as
                  semantic-color noise. */}
              <div
                aria-hidden="true"
                className="absolute inset-y-0 left-0 -z-10 rounded-sm bg-brand/15"
                style={{ width: `${pct}%` }}
              />
              <div className="flex items-center gap-3 px-2 py-2.5">
                <Link
                  href={`/account/${r.address}`}
                  className="font-mono text-cell text-brand hover:underline truncate min-w-0 flex-1"
                >
                  {r.address.slice(0, 8)}...{r.address.slice(-4)}
                </Link>
                {!isSnapshotSource && r.paymentCount > 0 && (
                  <span className="hidden sm:inline font-mono text-tag text-muted tabular-nums shrink-0">
                    {r.paymentCount} {r.paymentCount === 1 ? "pmt" : "pmts"}
                  </span>
                )}
                {showInsiderBadge && (
                  <span
                    className="shrink-0 rounded-full bg-error/10 px-1.5 py-0.5 font-mono text-micro font-semibold text-error"
                    title="Currently a top-10 holder of this token"
                  >
                    #{r.holderRank}
                  </span>
                )}
                {/* "% of supply" leads — that's the actually-meaningful
                    number for ranking; the raw token amount is the
                    secondary detail. Both shown so users can sanity
                    check against external explorers. */}
                {supplyPct !== null && (
                  <span className="font-mono text-cell text-primary font-medium tabular-nums shrink-0">
                    {supplyPct.toFixed(2)}%
                  </span>
                )}
                <span className="font-mono text-tag text-muted tabular-nums shrink-0">
                  {formatAmount(r.amountReceived)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
