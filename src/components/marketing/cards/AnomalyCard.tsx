import { Card, Row, TypeTag } from "@/components/shared/PreviewPrimitives";

/* ————————————————————————————————————————————
   Anomaly detection tweet card.

   Tweet format: a network-level anomaly detected by Sonde's Log-Z
   seasonal scoring engine, with the metric as a headline, severity
   badge, and 2–4 evidence rows. Designed for "we caught this" posts.
   ———————————————————————————————————————————— */

type AnomalySeverity = "low" | "medium" | "high";

export interface AnomalyCardProps {
  /** Short pattern description, e.g. "Transaction Volume Spike" */
  pattern: string;
  severity: AnomalySeverity;
  /** Up to 4 label/value rows describing the evidence */
  metrics: { label: string; value: string }[];
  /** ISO 8601 timestamp */
  detectedAt: string;
}

const DEFAULT_PROPS: AnomalyCardProps = {
  pattern: "Transaction Volume Spike",
  severity: "high",
  metrics: [
    { label: "Current", value: "12,840 txns/hr" },
    { label: "Expected", value: "4,210 txns/hr" },
    { label: "Deviation", value: "+205%" },
    { label: "Z-Score", value: "3.82" },
  ],
  detectedAt: "2026-04-10T14:18:00Z",
};

const SEVERITY_COLOR: Record<AnomalySeverity, string> = {
  low: "var(--color-muted)",
  medium: "var(--color-warning)",
  high: "var(--color-error)",
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.max(0, Math.round((now - then) / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

export function AnomalyCard(props: Partial<AnomalyCardProps> = {}) {
  const { pattern, severity, metrics, detectedAt } = {
    ...DEFAULT_PROPS,
    ...props,
  };

  return (
    <Card>
      {/* Header with severity tag */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          Anomaly Detection
        </span>
        <TypeTag label={severity} color={SEVERITY_COLOR[severity]} />
      </div>

      {/* Pattern as headline */}
      <div className="px-6 py-6 text-center">
        <div className="font-display text-heading font-bold text-primary">
          {pattern}
        </div>
      </div>

      {/* Evidence rows */}
      {metrics.slice(0, 4).map((m) => (
        <Row key={m.label} label={m.label} value={m.value} />
      ))}

      {/* Footer timestamp */}
      <div className="border-t border-elevated px-4 py-2 text-right">
        <span className="font-display text-tag uppercase tracking-header text-muted">
          Flagged {formatRelativeTime(detectedAt)}
        </span>
      </div>
    </Card>
  );
}

export default AnomalyCard;
