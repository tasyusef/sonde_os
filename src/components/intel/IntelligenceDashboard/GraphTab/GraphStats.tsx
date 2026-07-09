import { cn } from "@/lib/utils";

export default function GraphStats({
  mode,
  pathCount,
  nodeCount,
  edgeCount,
  connected,
}: {
  mode: "trace" | "connections";
  pathCount: number;
  nodeCount: number;
  edgeCount: number;
  connected?: boolean;
}) {
  return (
    <div className="flex items-center gap-6">
      {mode === "connections" && connected != null && (
        <div className={cn("rounded-full px-4 py-1.5 font-mono text-cell font-semibold", connected ? "bg-success/10 text-success" : "bg-error/10 text-error")}>
          {connected ? "Connected" : "No Connection Found"}
        </div>
      )}
      <div>
        <span className="font-display text-label uppercase tracking-header text-muted">
          {mode === "connections" ? "Shared" : "Paths"}
        </span>
        <p className="font-mono text-value font-semibold text-primary">{pathCount}</p>
      </div>
      <div>
        <span className="font-display text-label uppercase tracking-header text-muted">Nodes</span>
        <p className="font-mono text-value font-semibold text-primary">{nodeCount}</p>
      </div>
      <div>
        <span className="font-display text-label uppercase tracking-header text-muted">Edges</span>
        <p className="font-mono text-value font-semibold text-primary">{edgeCount}</p>
      </div>
    </div>
  );
}
