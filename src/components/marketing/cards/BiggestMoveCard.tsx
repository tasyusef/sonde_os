import { Card } from "@/components/shared/PreviewPrimitives";

/* ————————————————————————————————————————————
   "Biggest move" tweet card.

   Tweet format: a single huge metric with one-line framing above
   ("Biggest XRPL transaction this week", "Highest fee paid today",
   "Largest AMM deposit this month"). Maximally flexible — useful for
   any "this happened on XRPL today" hook where one number is the
   entire story.
   ———————————————————————————————————————————— */

export interface BiggestMoveCardProps {
  /** Uppercase mono header above the value (e.g. "BIGGEST XRPL TRANSACTION TODAY") */
  headline: string;
  /** The hero value (e.g. "$3.2M", "1,240,000 XRP", "47.8K") */
  value: string;
  /** Optional one-line context below the value */
  context?: string;
  /** Optional period chip (e.g. "24H", "7D") */
  period?: string;
}

const DEFAULT_PROPS: BiggestMoveCardProps = {
  headline: "Biggest XRPL Transaction",
  value: "3,240,000 XRP",
  context: "rN7d4…kF92 → rPqB8…xZ31",
  period: "24H",
};

export function BiggestMoveCard(props: Partial<BiggestMoveCardProps> = {}) {
  const { headline, value, context, period } = { ...DEFAULT_PROPS, ...props };

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          {headline}
        </span>
        {period && (
          <span className="font-display text-tag uppercase tracking-header text-muted">
            {period}
          </span>
        )}
      </div>

      {/* Hero */}
      <div className="px-6 py-12 text-center">
        <div className="font-mono text-display-lg font-medium tabular-nums text-primary">
          {value}
        </div>
        {context && (
          <div className="mt-4 font-mono text-cell text-secondary">
            {context}
          </div>
        )}
      </div>
    </Card>
  );
}

export default BiggestMoveCard;
