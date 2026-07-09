"use client";

import { useState, useCallback, useId } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useIntelligence } from "../../IntelligenceContext";
import GraphView, { type GraphNode, type GraphEdge } from "../../GraphView";
import NodeTooltip from "../../GraphView/NodeTooltip";
import LinkTooltip from "../../GraphView/LinkTooltip";
import TraceControls from "./TraceControls";
import ConnectionControls from "./ConnectionControls";
import GraphStats from "./GraphStats";
import { cn } from "@/lib/utils";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

type Mode = "trace" | "connections";

function clampDepth(n: number, max: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(max, Math.floor(n));
}

interface TraceResult {
  account: string;
  direction: string;
  depth: number;
  pathCount: number;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

interface ConnectionResult {
  source: string;
  target: string;
  pathCount: number;
  connected: boolean;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

export default function GraphTab() {
  const { activeAccount, setActiveAccount } = useIntelligence();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Initialize state from URL so shared links (`?mode=trace&seed=rXxx&depth=3`,
  // `?mode=connections&from=rX&to=rY&maxDepth=6`) land in the right mode with
  // controls prefilled. After first paint, URL updates are driven by user
  // interactions (mode toggle, form submit), not state echo.
  const initialMode = searchParams.get("mode") === "connections" ? "connections" : "trace";
  const [mode, setMode] = useState<Mode>(initialMode);

  const qSeed = searchParams.get("seed") ?? "";
  const qFrom = searchParams.get("from") ?? "";
  const qTo = searchParams.get("to") ?? "";
  const qDepth = Number(searchParams.get("depth") ?? "");

  // Trace state
  const [traceAddr, setTraceAddr] = useState(
    XRPL_ADDRESS_RE.test(qSeed) ? qSeed : "",
  );
  const [direction, setDirection] = useState<"both" | "incoming" | "outgoing">("both");
  const [traceDepth, setTraceDepth] = useState(
    qDepth > 0 ? clampDepth(qDepth, 5) : 3,
  );
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);

  // Connection state. Pre-2026-04-30 the connections mode took a
  // maxDepth param to bound shortest-path search; the route now does
  // a depth-less common-counterparty intersect, so depth is gone.
  const [connSource, setConnSource] = useState(
    XRPL_ADDRESS_RE.test(qFrom) ? qFrom : "",
  );
  const [connTarget, setConnTarget] = useState(
    XRPL_ADDRESS_RE.test(qTo) ? qTo : "",
  );
  const [connResult, setConnResult] = useState<ConnectionResult | null>(null);
  const [connLoading, setConnLoading] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);

  // Tooltip state
  const [hoveredNode, setHoveredNode] = useState<{ address: string; x: number; y: number } | null>(null);
  const [hoveredLink, setHoveredLink] = useState<{ edge: GraphEdge; x: number; y: number } | null>(null);

  const pillId = useId();
  const traceAddress = activeAccount ?? traceAddr;
  const sourceAddress = activeAccount ?? connSource;

  // Note: useState initializers above only run on first mount, so
  // back-button navigation after the user has been interacting with
  // the tab won't resync state from the URL. That's intentional — the
  // React Compiler rules forbid setState-in-effect syncs, and a full
  // URL-derived refactor is scope for later. In practice the initial
  // hydration covers shared-link and cold-load entry which is the main
  // ask.

  // URL sync is event-driven — fires only from submit handlers and the
  // mode toggle, not from state effects. Keeps shareable links clean
  // (no half-typed addresses in the URL).
  const pushUrlForTrace = (addr: string, depth: number) => {
    const params = new URLSearchParams();
    params.set("tab", "graph");
    params.set("mode", "trace");
    if (XRPL_ADDRESS_RE.test(addr)) params.set("seed", addr);
    params.set("depth", String(depth));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const pushUrlForConnections = (from: string, to: string) => {
    const params = new URLSearchParams();
    params.set("tab", "graph");
    params.set("mode", "connections");
    if (XRPL_ADDRESS_RE.test(from)) params.set("from", from);
    if (XRPL_ADDRESS_RE.test(to)) params.set("to", to);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const pushUrlForMode = (m: Mode) => {
    const params = new URLSearchParams();
    params.set("tab", "graph");
    params.set("mode", m);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleTrace = useCallback(async () => {
    const target = traceAddress;
    if (!target) return;
    setTraceLoading(true);
    setTraceError(null);
    try {
      const res = await fetch("/api/intel/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: target, direction, depth: traceDepth }),
      });
      if (!res.ok) { let msg = `HTTP ${res.status}`; try { const d = await res.json(); msg = d.error || msg; } catch {} throw new Error(msg); }
      setTraceResult(await res.json());
      setActiveAccount(target);
      pushUrlForTrace(target, traceDepth);
    } catch (err) {
      setTraceError(err instanceof Error ? err.message : "Trace failed");
      setTraceResult(null);
    } finally {
      setTraceLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pushUrlForTrace is redefined per render intentionally; closing over latest pathname/router is fine since we only call it inside this submit handler.
  }, [traceAddress, direction, traceDepth, setActiveAccount]);

  const handleSearch = useCallback(async () => {
    if (!sourceAddress || !connTarget) return;
    setConnLoading(true);
    setConnError(null);
    try {
      const res = await fetch("/api/intel/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceAddress, target: connTarget }),
      });
      if (!res.ok) { let msg = `HTTP ${res.status}`; try { const d = await res.json(); msg = d.error || msg; } catch {} throw new Error(msg); }
      setConnResult(await res.json());
      pushUrlForConnections(sourceAddress, connTarget);
    } catch (err) {
      setConnError(err instanceof Error ? err.message : "Search failed");
      setConnResult(null);
    } finally {
      setConnLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- see handleTrace
  }, [sourceAddress, connTarget]);

  const handleNodeClick = (addr: string) => {
    setActiveAccount(addr);
    if (mode === "trace") setTraceAddr(addr);
    else setConnSource(addr);
    setHoveredNode(null);
  };

  const result = mode === "trace" ? traceResult : connResult;
  const error = mode === "trace" ? traceError : connError;
  const currentNodes = result?.graph.nodes ?? [];
  const currentEdges = result?.graph.edges ?? [];

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex shrink-0 items-center rounded-full border border-elevated bg-elevated p-0.5 w-fit" role="radiogroup" aria-label="Graph mode">
        {(["trace", "connections"] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} onClick={() => { setMode(m); pushUrlForMode(m); }}
            className={cn("relative rounded-full px-3 py-1 font-mono text-label font-medium uppercase tracking-pill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
              mode === m ? "text-brand" : "text-muted hover:text-secondary")}>
            {mode === m && (
              <motion.div
                layoutId={`graph-mode-${pillId}`}
                className="absolute inset-0 rounded-full bg-surface shadow-sm"
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
            <span className="relative z-10">{m === "trace" ? "Trace" : "Connections"}</span>
          </button>
        ))}
      </div>

      {/* Controls */}
      {mode === "trace" ? (
        <TraceControls address={traceAddress} setAddress={(v) => { setTraceAddr(v); setActiveAccount(null); }}
          direction={direction} setDirection={setDirection} depth={traceDepth} setDepth={setTraceDepth}
          onTrace={handleTrace} loading={traceLoading} />
      ) : (
        <ConnectionControls source={sourceAddress} setSource={(v) => { setConnSource(v); setActiveAccount(null); }}
          target={connTarget} setTarget={setConnTarget}
          onSearch={handleSearch} loading={connLoading} />
      )}

      {/* Error */}
      {error && (
        <div role="alert" className="rounded-lg border border-error/20 bg-error/5 px-4 py-3">
          <p className="font-mono text-cell text-error">{error}</p>
        </div>
      )}

      {/* Stats */}
      {result && (
        <GraphStats mode={mode} pathCount={result.pathCount} nodeCount={currentNodes.length}
          edgeCount={currentEdges.length}
          connected={mode === "connections" ? (connResult?.connected ?? undefined) : undefined} />
      )}

      {/* Graph + Tooltips */}
      {currentNodes.length > 0 && (
        <div className="relative">
          <GraphView
            nodes={currentNodes}
            edges={currentEdges}
            focusAddress={mode === "trace" ? traceResult?.account : connResult?.source}
            onNodeClick={handleNodeClick}
            onNodeHover={(addr, x, y) => {
              setHoveredLink(null);
              setHoveredNode(addr ? { address: addr, x, y } : null);
            }}
            onLinkHover={(edge, x, y) => {
              setHoveredNode(null);
              setHoveredLink(edge ? { edge, x, y } : null);
            }}
            className="h-[500px]"
          />
          {hoveredNode && (
            <NodeTooltip address={hoveredNode.address} screenX={hoveredNode.x} screenY={hoveredNode.y}
              edges={currentEdges} onSetActiveAccount={handleNodeClick} />
          )}
          {hoveredLink && (
            <LinkTooltip edge={hoveredLink.edge} screenX={hoveredLink.x} screenY={hoveredLink.y} />
          )}
        </div>
      )}
    </div>
  );
}
