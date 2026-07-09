import type { AmendmentSummary } from "@/types/amendments";

interface AmendmentSummaryBarProps {
  summary: AmendmentSummary;
}

const stats = [
  { key: "totalKnown", label: "Total Known" },
  { key: "enabled", label: "Enabled" },
  { key: "pending", label: "Pending" },
  { key: "withMajority", label: "Has Majority" },
] as const;

export function AmendmentSummaryBar({ summary }: AmendmentSummaryBarProps) {
  return (
    <div className="mb-6 rounded-2xl shadow-card bg-surface px-5 py-4">
      <h2 className="mb-3 font-display text-label font-bold uppercase tracking-header text-brand">
        Amendment Overview
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.key}>
            <p className="font-display text-label uppercase tracking-header text-muted">
              {s.label}
            </p>
            <p className="mt-0.5 font-mono text-value font-semibold text-primary">
              {summary[s.key]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AmendmentSummaryBar;
