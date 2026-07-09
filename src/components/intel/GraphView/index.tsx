"use client";

import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

// react-force-graph-2d uses Canvas + d3-force — must be client-only
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GraphNode {
  address: string;
  first_seen: number | null;
  last_active: number | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  amount: number;
  currency: string;
  timestamp: number;
  tx_hash: string;
  type: string;
}

interface GraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusAddress?: string;
  onNodeClick?: (address: string) => void;
  onNodeHover?: (address: string | null, screenX: number, screenY: number) => void;
  onLinkHover?: (edge: GraphEdge | null, screenX: number, screenY: number) => void;
  className?: string;
  /**
   * Lock the canvas to fixed dimensions. When set, bypasses the ResizeObserver's
   * responsive width calculation and the 400px minimum height. Used by the
   * marketing card route so the graph renders at a consistent size for
   * screenshot capture.
   */
  fixedWidth?: number;
  fixedHeight?: number;
  /**
   * Hide the chrome (outer border, rounded corners, surface background, legend,
   * stats overlay). Used by the marketing card route so the graph fits cleanly
   * inside the outer <Card> primitive without double borders.
   */
  chromeless?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Internal force-graph data shapes                                   */
/* ------------------------------------------------------------------ */

interface FGNode {
  id: string;
  address: string;
  first_seen: number | null;
  last_active: number | null;
  isFocus: boolean;
}

interface FGLink {
  source: string;
  target: string;
  amount: number;
  currency: string;
  timestamp: number;
  tx_hash: string;
  type: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function GraphView({
  nodes,
  edges,
  focusAddress,
  onNodeClick,
  onNodeHover,
  onLinkHover,
  className,
  fixedWidth,
  fixedHeight,
  chromeless = false,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<{
    zoomToFit: (ms?: number, padding?: number) => void;
    graph2ScreenCoords: (x: number, y: number) => { x: number; y: number };
  } | null>(null);
  const [dimensions, setDimensions] = useState(() => ({
    width:
      fixedWidth ??
      (typeof window !== "undefined" ? Math.min(window.innerWidth - 24, 600) : 600),
    height:
      fixedHeight ??
      (typeof window !== "undefined" && window.innerWidth < 640 ? 300 : 400),
  }));

  // Read CSS custom properties so canvas colors respect light/dark mode
  const themeColors = useRef({ brand: "#E8856C", muted: "#7B8291", secondary: "#9CA3AF" });
  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    themeColors.current = {
      brand: s.getPropertyValue("--color-brand").trim() || "#E8856C",
      muted: s.getPropertyValue("--color-muted").trim() || "#7B8291",
      secondary: s.getPropertyValue("--color-secondary").trim() || "#9CA3AF",
    };
  });

  // Resize observer for responsive canvas. Skipped when fixed dimensions are
  // provided — the marketing card route uses fixedWidth/fixedHeight to lock the
  // layout for consistent screenshots.
  useEffect(() => {
    if (fixedWidth != null && fixedHeight != null) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: fixedWidth ?? entry.contentRect.width,
          height: fixedHeight ?? Math.max(400, entry.contentRect.height),
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fixedWidth, fixedHeight]);

  // Zoom to fit when data changes
  useEffect(() => {
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(300, 40);
    }, 500);
    return () => clearTimeout(timer);
  }, [nodes, edges]);

  // Build force-graph data (memoized to avoid re-initializing simulation)
  const graphData = useMemo(() => ({
    nodes: nodes.map((n): FGNode => ({
      id: n.address,
      address: n.address,
      first_seen: n.first_seen,
      last_active: n.last_active,
      isFocus: n.address === focusAddress,
    })),
    links: edges.map((e): FGLink => ({
      source: e.from,
      target: e.to,
      amount: e.amount,
      currency: e.currency,
      timestamp: e.timestamp,
      tx_hash: e.tx_hash,
      type: e.type,
    })),
  }), [nodes, edges, focusAddress]);

  const handleNodeClick = useCallback(
    (node: FGNode) => {
      onNodeClick?.(node.address);
    },
    [onNodeClick],
  );

  const handleNodeHover = useCallback(
    (node: FGNode | null) => {
      if (!onNodeHover) return;
      if (!node || !fgRef.current?.graph2ScreenCoords || !containerRef.current) {
        onNodeHover(null, 0, 0);
        return;
      }
      const nx = (node as FGNode & { x?: number }).x ?? 0;
      const ny = (node as FGNode & { y?: number }).y ?? 0;
      const screen = fgRef.current.graph2ScreenCoords(nx, ny);
      const rect = containerRef.current.getBoundingClientRect();
      onNodeHover(node.address, rect.left + screen.x, rect.top + screen.y);
    },
    [onNodeHover],
  );

  const handleLinkHover = useCallback(
    (link: FGLink | null) => {
      if (!onLinkHover) return;
      if (!link || !fgRef.current?.graph2ScreenCoords || !containerRef.current) {
        onLinkHover(null, 0, 0);
        return;
      }
      // Use midpoint of source and target
      const src = link.source as unknown as { x?: number; y?: number };
      const tgt = link.target as unknown as { x?: number; y?: number };
      const mx = ((src.x ?? 0) + (tgt.x ?? 0)) / 2;
      const my = ((src.y ?? 0) + (tgt.y ?? 0)) / 2;
      const screen = fgRef.current.graph2ScreenCoords(mx, my);
      const rect = containerRef.current.getBoundingClientRect();
      const edge: GraphEdge = {
        from: typeof link.source === "string" ? link.source : (link.source as unknown as { id: string }).id,
        to: typeof link.target === "string" ? link.target : (link.target as unknown as { id: string }).id,
        amount: link.amount,
        currency: link.currency,
        timestamp: link.timestamp,
        tx_hash: link.tx_hash,
        type: link.type,
      };
      onLinkHover(edge, rect.left + screen.x, rect.top + screen.y);
    },
    [onLinkHover],
  );

  const nodeCanvasObject = useCallback(
    (node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = (node as FGNode & { x?: number }).x ?? 0;
      const y = (node as FGNode & { y?: number }).y ?? 0;
      const isFocus = node.isFocus;
      const radius = isFocus ? 6 : 4;

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      const { brand, muted, secondary } = themeColors.current;
      ctx.fillStyle = isFocus ? brand : muted;
      ctx.fill();

      if (isFocus) {
        ctx.strokeStyle = brand;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Label — show truncated address when zoomed in enough
      if (globalScale > 1.5) {
        const label = node.address.slice(0, 6) + "..." + node.address.slice(-4);
        const fontSize = Math.max(10 / globalScale, 3);
        ctx.font = `${fontSize}px "Geist Mono", monospace`;
        ctx.fillStyle = isFocus ? brand : secondary;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(label, x, y + radius + 2);
      }
    },
    [],
  );

  const linkColor = useCallback((link: FGLink) => {
    const { brand, muted } = themeColors.current;
    // Convert hex to rgba with opacity for links
    const toRgba = (hex: string, a: number) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    };
    return link.type === "PAYMENT" ? toRgba(brand, 0.3) : toRgba(muted, 0.25);
  }, []);

  const containerMinHeight =
    fixedHeight ??
    (typeof window !== "undefined" && window.innerWidth < 640 ? 300 : 400);

  const containerStyle: React.CSSProperties = {
    minHeight: containerMinHeight,
    ...(fixedWidth != null ? { width: fixedWidth } : {}),
    ...(fixedHeight != null ? { height: fixedHeight } : {}),
  };

  const chromeClasses = chromeless
    ? "relative overflow-hidden"
    : "relative overflow-hidden rounded-2xl border border-elevated bg-surface";

  if (nodes.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center", chromeClasses, className)}
        style={containerStyle}
      >
        <p className="font-mono text-cell text-muted">No graph data</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`Transaction graph: ${nodes.length} accounts, ${edges.length} connections`}
      className={cn(chromeClasses, className)}
      style={containerStyle}
    >
      <ForceGraph2D
        ref={fgRef as never}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        nodeCanvasObject={nodeCanvasObject as never}
        nodePointerAreaPaint={((node: Record<string, unknown>, color: string, ctx: CanvasRenderingContext2D) => {
          const x = (node.x as number) ?? 0;
          const y = (node.y as number) ?? 0;
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }) as never}
        linkColor={linkColor as never}
        linkWidth={1}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={0.9}
        onNodeClick={handleNodeClick as never}
        onNodeHover={handleNodeHover as never}
        onLinkHover={handleLinkHover as never}
        backgroundColor="transparent"
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />

      {!chromeless && (
        <>
          {/* Legend */}
          <div className="absolute bottom-3 left-3 flex gap-4 rounded-lg bg-surface/80 px-3 py-1.5 backdrop-blur-sm">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-brand" />
              <span className="font-mono text-label text-muted">Payment</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-secondary" />
              <span className="font-mono text-label text-muted">DEX Trade</span>
            </span>
          </div>

          {/* Stats */}
          <div className="absolute top-3 right-3 rounded-lg bg-surface/80 px-3 py-1.5 backdrop-blur-sm">
            <span className="font-mono text-label text-muted">
              {nodes.length} nodes &middot; {edges.length} edges
            </span>
          </div>
        </>
      )}
    </div>
  );
}
