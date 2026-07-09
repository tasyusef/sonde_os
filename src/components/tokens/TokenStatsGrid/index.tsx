import type { TokenDetail } from "@/types/token";
import { formatCompactNumber } from "@/lib/xrpl-helpers";

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card">
      <p className="font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </p>
      <p className="mt-1 font-mono text-value font-bold text-primary">
        {value}
      </p>
    </div>
  );
}

export default function TokenStatsGrid({ token }: { token: TokenDetail }) {
  const { metrics } = token;

  const stats = [
    {
      label: "Market Cap",
      value:
        metrics.marketcap != null
          ? `${formatCompactNumber(metrics.marketcap)} XRP`
          : "\u2014",
    },
    {
      label: "Volume 24H",
      value:
        metrics.volume24h != null
          ? `${formatCompactNumber(metrics.volume24h)} XRP`
          : "\u2014",
    },
    {
      label: "Volume 7D",
      value:
        metrics.volume7d != null
          ? `${formatCompactNumber(metrics.volume7d)} XRP`
          : "\u2014",
    },
    {
      label: "Holders",
      value: metrics.holders != null ? metrics.holders.toLocaleString() : "\u2014",
    },
    {
      label: "Trust Lines",
      value:
        metrics.trustlines != null
          ? metrics.trustlines.toLocaleString()
          : "\u2014",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((s) => (
        <StatCard key={s.label} label={s.label} value={s.value} />
      ))}
    </div>
  );
}

export { TokenStatsGrid };
