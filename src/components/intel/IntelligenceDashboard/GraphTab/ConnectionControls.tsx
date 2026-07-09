import Button from "@/components/shared/Button";

/**
 * 2026-04-30: This panel feeds the connections route, which was
 * reshaped from "shortest paths between A and B" to "common
 * counterparties of A and B" alongside the Neo4j cut. The depth
 * slider used to bound shortest-path search; with intersect-based
 * common counterparties there's no depth dimension, so the slider
 * is gone.
 */
export default function ConnectionControls({
  source,
  setSource,
  target,
  setTarget,
  onSearch,
  loading,
}: {
  source: string;
  setSource: (v: string) => void;
  target: string;
  setTarget: (v: string) => void;
  onSearch: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex-1 min-w-0 sm:min-w-[240px]">
        <label htmlFor="conn-src" className="mb-1.5 block font-display text-label font-medium uppercase tracking-header text-muted">Source</label>
        <input id="conn-src" type="text" value={source} onChange={(e) => setSource(e.target.value)} placeholder="rXYZ..."
          className="w-full rounded-lg border border-elevated bg-elevated px-3 py-2 font-mono text-cell text-primary placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50" />
      </div>
      <div className="flex-1 min-w-0 sm:min-w-[240px]">
        <label htmlFor="conn-tgt" className="mb-1.5 block font-display text-label font-medium uppercase tracking-header text-muted">Target</label>
        <input id="conn-tgt" type="text" value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !loading && onSearch()} placeholder="rABC..."
          className="w-full rounded-lg border border-elevated bg-elevated px-3 py-2 font-mono text-cell text-primary placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50" />
      </div>
      <Button onClick={onSearch} disabled={!source || !target} loading={loading} variant="primary" size="md">
        {loading ? "Searching..." : "Find Common Counterparties"}
      </Button>
    </div>
  );
}
