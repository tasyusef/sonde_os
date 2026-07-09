import { Info } from "lucide-react";

/**
 * Small info pill for page heroes — surfaces the fact that Sonde's
 * historical depth is limited (currently ~11 months, since ingestion
 * started 2025-06). Without this, users browsing dashboards or smart-
 * money rankings have no signal that "all-time" really means "since
 * we started indexing." Native `title` tooltip carries the longer
 * explanation; the pill itself stays glanceable.
 */
export default function DataWindowBadge() {
  return (
    <span
      title="Sonde began indexing the XRPL in June 2025. 'All-time' rankings, charts, and totals reflect that window — older history isn't available yet."
      className="inline-flex items-center gap-1.5 rounded-full border border-elevated bg-elevated/40 px-2 py-0.5 font-display text-tag font-medium uppercase tracking-header text-muted"
    >
      <Info size={11} aria-hidden="true" />
      ~11mo data window
    </span>
  );
}
