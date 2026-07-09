"use client";

import useSWR from "swr";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { dropsToXrp } from "@/lib/xrpl-helpers";
import { useCollapsibleCard } from "@/hooks/useCollapsibleCard";

/**
 * AccountProfile — combined risk + behavioral summary for an account.
 *
 * Merges the previously-separate RiskProfile and BehavioralProfile cards
 * since they pulled from the same upstream graph features and ended up
 * showing identical payments-in/out/trades/counterparties data twice.
 *
 * Card has one job now: surface the score (top-left gauge), the
 * glanceable activity trio (top-right), and the deeper breakdown on
 * expand. Two endpoints stay separate behind the scenes — fetched in
 * parallel via SWR — until backend dedup makes that worth a single
 * combined route.
 *
 * Silent-null on 401/403 — the card simply disappears for free tier
 * viewers rather than rendering a broken-looking empty surface.
 */

interface RiskData {
  account: string;
  riskScore: number;
  riskLevel: "high" | "medium" | "low" | "none";
  factors: {
    washPatterns: number;
    lowDiversity: number;
    highFrequency: number;
    lowEntropy: number;
    circularPayments: number;
  };
  graphFeatures: {
    degree: number;
    inDegree: number;
    outDegree: number;
    tradeCount: number;
    uniqueCounterparties: number;
    inOutRatio: number;
    activitySpan: number;
  } | null;
  behavioralFeatures: {
    txCount: number;
    txTypeDiversity: number;
    avgTxPerDay: number;
    maxTxPerHour: number;
    peakHourUtc: number;
    hourEntropy: number;
    activeDays: number;
  } | null;
  washFlags: Array<{ pattern: string; confidence: number; evidence: string }>;
}

interface ProfileData {
  account: string;
  graph: {
    firstSeen: number | null;
    lastActive: number | null;
    paymentsIn: number;
    paymentsOut: number;
    dexTrades: number;
    uniqueCounterparties: number;
  } | null;
  timeSeries: {
    txCount: number;
    totalFeeDrops: string;
    firstTx: string;
    lastTx: string;
    txTypes: string[];
  } | null;
}

const RISK_COLORS = {
  high: { bg: "bg-error/10", text: "text-error", bar: "bg-error" },
  medium: { bg: "bg-warning/10", text: "text-warning", bar: "bg-warning" },
  low: { bg: "bg-success/10", text: "text-success", bar: "bg-success" },
  none: { bg: "bg-elevated", text: "text-muted", bar: "bg-muted" },
} as const;

async function jsonOrNull<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** XRPL epoch (2000-01-01) → JS Date. */
function xrplTimeToDate(t: number): Date {
  return new Date((t + 946684800) * 1000);
}

function formatAge(firstSeen: number | null): string {
  if (firstSeen == null) return "—";
  const days = Math.max(
    0,
    Math.floor((Date.now() - xrplTimeToDate(firstSeen).getTime()) / 86_400_000),
  );
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const leftover = days % 365;
    return leftover > 0 ? `${years}y ${leftover}d` : `${years}y`;
  }
  return `${days}d`;
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function AccountProfile({ address }: { address: string }) {
  const { data: risk, isLoading: riskLoading } = useSWR<RiskData | null>(
    `/api/intel/risk?account=${encodeURIComponent(address)}`,
    jsonOrNull,
    { dedupingInterval: 60_000, revalidateOnFocus: false },
  );
  const { data: profile, isLoading: profileLoading } = useSWR<ProfileData | null>(
    `/api/intel/profile?account=${encodeURIComponent(address)}`,
    jsonOrNull,
    { dedupingInterval: 60_000, revalidateOnFocus: false },
  );

  const [expanded, toggle] = useCollapsibleCard("account-profile", true);

  if (riskLoading || profileLoading) {
    return (
      <div
        role="status"
        aria-label="Loading account profile"
        className="animate-pulse motion-reduce:animate-none rounded-2xl bg-elevated h-48"
      />
    );
  }

  // Both Pro-gated. If neither responded with data, hide the card.
  if (!risk && !profile) return null;

  const colors = RISK_COLORS[risk?.riskLevel ?? "none"];
  const riskScore = risk?.riskScore ?? 0;
  const nonZeroFactors = risk
    ? Object.entries(risk.factors).filter(([, v]) => v > 0)
    : [];
  const flagCount = risk?.washFlags.length ?? 0;
  const summaryCaption = !risk
    ? null
    : risk.riskScore === 0
      ? "No risk indicators detected"
      : [
          `${nonZeroFactors.length} factor${nonZeroFactors.length !== 1 ? "s" : ""}`,
          flagCount > 0 && `${flagCount} flagged`,
        ]
          .filter(Boolean)
          .join(" · ");

  const ageLabel = profile?.graph ? formatAge(profile.graph.firstSeen) : "—";
  const txCountLabel = profile?.timeSeries
    ? profile.timeSeries.txCount.toLocaleString()
    : risk?.behavioralFeatures
      ? risk.behavioralFeatures.txCount.toLocaleString()
      : "—";
  const lastActiveLabel =
    profile?.graph?.lastActive != null
      ? formatRelativeTime(xrplTimeToDate(profile.graph.lastActive).toISOString())
      : "—";

  const totalFeeXrp = profile?.timeSeries
    ? dropsToXrp(profile.timeSeries.totalFeeDrops)
    : null;
  const txTypes = profile?.timeSeries?.txTypes ?? [];

  return (
    <section
      aria-label="Account profile"
      className="rounded-2xl border border-elevated bg-surface shadow-card"
    >
      {/* Header — risk gauge + level chip on the left, glanceable trio
           below. Whole header is the toggle target. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls="account-profile-body"
        className="w-full text-left p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-2xl"
      >
        <div className="flex items-start gap-3 sm:gap-4">
          {risk && (
            <div
              className="relative h-14 w-14 shrink-0"
              title="Composite risk score (0–100) based on graph topology, behavioral patterns, and wash trading detection"
            >
              <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
                <circle
                  cx="18"
                  cy="18"
                  r="15.91"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-elevated"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="15.91"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${riskScore} ${100 - riskScore}`}
                  className={colors.text}
                  strokeLinecap="round"
                />
              </svg>
              <span
                className={cn(
                  "absolute inset-0 flex items-center justify-center font-mono text-cell font-bold",
                  colors.text,
                )}
              >
                {riskScore}
              </span>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="font-display text-label font-semibold uppercase tracking-header text-muted">
                Account Profile
              </h2>
              {risk && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-label font-semibold uppercase",
                    colors.bg,
                    colors.text,
                  )}
                >
                  {risk.riskLevel} risk
                </span>
              )}
            </div>
            {summaryCaption && (
              <p className="mt-1 font-mono text-label text-muted">
                {summaryCaption}
              </p>
            )}
          </div>

          <ChevronDown
            aria-hidden="true"
            className={cn(
              "mt-1 h-5 w-5 shrink-0 text-muted transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <SummaryStat label="Age" value={ageLabel} />
          <SummaryStat label="Transactions" value={txCountLabel} />
          <SummaryStat label="Last active" value={lastActiveLabel} />
        </div>
      </button>

      {/* Expanded body — same CSS-grid auto-height collapse pattern as
           the other intel sidebar cards. */}
      <div
        id="account-profile-body"
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:duration-0",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-elevated">
            {/* Risk factors */}
            {nonZeroFactors.length > 0 && (
              <div className="p-4 border-b border-elevated space-y-3">
                <h3 className="font-display text-label font-semibold uppercase tracking-header text-muted">
                  Risk Factors
                </h3>
                {nonZeroFactors.map(([key, value]) => (
                  <div key={key}>
                    <div className="flex justify-between mb-1">
                      <span
                        className="font-mono text-cell text-primary cursor-help"
                        title={factorTip(key)}
                      >
                        {formatFactorName(key)}
                      </span>
                      <span className="font-mono text-cell text-muted">
                        +{value}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          colors.bar,
                        )}
                        style={{ width: `${Math.min(100, (value / 25) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Flagged patterns */}
            {risk && risk.washFlags.length > 0 && (
              <div className="p-4 border-b border-elevated space-y-2">
                <h3 className="font-display text-label font-semibold uppercase tracking-header text-muted">
                  Flagged Patterns
                </h3>
                {risk.washFlags.map((flag, i) => (
                  <div
                    key={i}
                    className="rounded-lg bg-error/5 border border-error/10 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="rounded-tag bg-error/10 px-2 py-0.5 font-mono text-tag font-medium text-error">
                        {formatPatternName(flag.pattern)}
                      </span>
                      <span className="font-mono text-label text-muted">
                        {Math.round(flag.confidence * 100)}% confidence
                      </span>
                    </div>
                    <p className="font-mono text-cell text-primary">
                      {flag.evidence}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Activity */}
            {profile?.graph && (
              <div className="border-b border-elevated px-4 py-3 space-y-1">
                <h3 className="mb-1.5 font-display text-label font-semibold uppercase tracking-header text-muted">
                  Activity
                </h3>
                <Row label="Payments in">
                  <Num value={profile.graph.paymentsIn} />
                </Row>
                <Row label="Payments out">
                  <Num value={profile.graph.paymentsOut} />
                </Row>
                <Row label="DEX trades">
                  <Num value={profile.graph.dexTrades} />
                </Row>
                <Row label="Counterparties">
                  <Num value={profile.graph.uniqueCounterparties} />
                </Row>
              </div>
            )}

            {/* Fees + tx types */}
            {profile?.timeSeries && (
              <div className="px-4 py-3 space-y-1">
                <Row label="Fees paid">
                  <span className="font-mono text-cell font-medium tabular-nums text-primary">
                    {Number(totalFeeXrp).toLocaleString(undefined, {
                      maximumFractionDigits: 4,
                    })}{" "}
                    XRP
                  </span>
                </Row>
                {txTypes.length > 0 && (
                  <div className="pt-2">
                    <span className="font-mono text-label text-muted mb-1.5 block">
                      Tx types ({txTypes.length})
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {txTypes.slice(0, 8).map((t) => (
                        <span
                          key={t}
                          className="rounded-tag bg-elevated px-2 py-0.5 font-mono text-tag text-secondary"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block font-display text-tag uppercase tracking-header text-muted truncate">
        {label}
      </span>
      <span className="block font-mono text-cell font-semibold tabular-nums text-primary truncate">
        {value}
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-label text-muted">{label}</span>
      {children}
    </div>
  );
}

function Num({ value }: { value: number }) {
  return (
    <span className="font-mono text-cell font-medium tabular-nums text-primary">
      {value.toLocaleString()}
    </span>
  );
}

const FACTOR_META: Record<string, { label: string; tip: string }> = {
  washPatterns: {
    label: "Wash Trading",
    tip: "Self-dealing patterns — buying and selling the same asset to inflate volume",
  },
  lowDiversity: {
    label: "Low Diversity",
    tip: "Most transactions target very few counterparties, suggesting coordinated activity",
  },
  highFrequency: {
    label: "High Frequency",
    tip: "Unusually high transaction rate per hour, often seen with bots or scripts",
  },
  lowEntropy: {
    label: "Time Concentration",
    tip: "Activity clustered in a narrow time window instead of spread across the day",
  },
  circularPayments: {
    label: "Circular Payments",
    tip: "Funds routed in loops back to the originating account",
  },
};

function formatFactorName(key: string): string {
  return FACTOR_META[key]?.label ?? key;
}

function factorTip(key: string): string | undefined {
  return FACTOR_META[key]?.tip;
}

function formatPatternName(pattern: string): string {
  const names: Record<string, string> = {
    circular_payments: "Circular Payments",
    rapid_pair_trading: "Rapid Pair Trading",
    low_diversity: "Low Diversity",
  };
  return names[pattern] ?? pattern;
}
