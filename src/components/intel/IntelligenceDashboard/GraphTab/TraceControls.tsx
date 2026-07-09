import { useId } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import Button from "@/components/shared/Button";

const DIRECTIONS = ["both", "incoming", "outgoing"] as const;

export default function TraceControls({
  address,
  setAddress,
  direction,
  setDirection,
  depth,
  setDepth,
  onTrace,
  loading,
}: {
  address: string;
  setAddress: (v: string) => void;
  direction: "both" | "incoming" | "outgoing";
  setDirection: (v: "both" | "incoming" | "outgoing") => void;
  depth: number;
  setDepth: (v: number) => void;
  onTrace: () => void;
  loading: boolean;
}) {
  const dirPillId = useId();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex-1 min-w-0 sm:min-w-[280px]">
        <label htmlFor="trace-addr" className="mb-1.5 block font-display text-label font-medium uppercase tracking-header text-muted">Account</label>
        <input
          id="trace-addr"
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && onTrace()}
          placeholder="rXYZ..."
          className="w-full rounded-lg border border-elevated bg-elevated px-3 py-2 font-mono text-cell text-primary placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        />
      </div>
      <div>
        <span className="mb-1.5 block font-display text-label font-medium uppercase tracking-header text-muted">Direction</span>
        <div className="flex shrink-0 items-center rounded-full border border-elevated bg-elevated p-0.5" role="radiogroup" aria-label="Trace direction">
          {DIRECTIONS.map((dir) => (
            <button key={dir} role="radio" aria-checked={direction === dir} onClick={() => setDirection(dir)}
              className={cn("relative rounded-full px-2.5 py-0.5 font-mono text-label font-medium capitalize tracking-pill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                direction === dir ? "text-brand" : "text-muted hover:text-secondary")}>
              {direction === dir && (
                <motion.div
                  layoutId={`trace-dir-${dirPillId}`}
                  className="absolute inset-0 rounded-full bg-surface shadow-sm"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}
              <span className="relative z-10">{dir}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="w-32">
        <label htmlFor="trace-depth" className="mb-1.5 block font-display text-label font-medium uppercase tracking-header text-muted">Depth: {depth}</label>
        <input id="trace-depth" type="range" min={1} max={6} value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="w-full accent-brand" />
      </div>
      <Button onClick={onTrace} disabled={!address} loading={loading} variant="primary" size="md">
        {loading ? "Tracing..." : "Trace"}
      </Button>
    </div>
  );
}
