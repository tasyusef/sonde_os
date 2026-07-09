"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useLiveData } from "@/hooks/useLiveData";
import type { CorridorEntry } from "@/types/analytics";
import { buildRibbonData, bezierPoint, NODE_PAD, NODE_WIDTH } from "./corridor-ribbon";

/* ------------------------------------------------------------------ */
/*  Live payment particle animation                                    */
/* ------------------------------------------------------------------ */

interface Particle {
  id: number;
  ribbonIdx: number;
  progress: number; // 0→1
  speed: number;
  opacity: number;
}

function useParticleAnimation(ribbonCount: number, corridors: CorridorEntry[]) {
  const { transactions } = useLiveData();
  const [particles, setParticles] = useState<Particle[]>([]);
  const nextId = useRef(0);
  const prevTxHashesRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef(0);

  // Spawn particles when new Payment txs arrive
  useEffect(() => {
    if (!transactions || corridors.length === 0 || ribbonCount === 0) return;

    const payments = transactions.filter((tx) => tx.type === "Payment");
    const newHashes = new Set(payments.map((tx) => tx.hash));
    const prev = prevTxHashesRef.current;

    const spawned: Particle[] = [];
    for (const tx of payments) {
      if (prev.has(tx.hash)) continue;
      const totalVol = corridors.reduce((s, c) => s + c.xrpVolume, 0);
      let roll = Math.random() * totalVol;
      let idx = 0;
      for (let i = 0; i < corridors.length && i < ribbonCount; i++) {
        roll -= corridors[i].xrpVolume;
        if (roll <= 0) { idx = i; break; }
      }
      spawned.push({ id: nextId.current++, ribbonIdx: idx, progress: 0, speed: 0.3 + Math.random() * 0.4, opacity: 1 });
    }

    prevTxHashesRef.current = newHashes;

    if (spawned.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- spawning particles from live SSE data
      setParticles((prev) => [...prev, ...spawned].slice(-30));
    }
  }, [transactions, corridors, ribbonCount]);

  // Animate particles with rAF
  useEffect(() => {
    function tick(time: number) {
      const dt = lastFrameRef.current ? (time - lastFrameRef.current) / 1000 : 0.016;
      lastFrameRef.current = time;
      setParticles((prev) => {
        const next: Particle[] = [];
        for (const p of prev) {
          const progress = p.progress + p.speed * dt;
          if (progress >= 1) continue;
          const opacity = progress > 0.8 ? 1 - (progress - 0.8) / 0.2 : 1;
          next.push({ ...p, progress, opacity });
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return particles;
}

/* ------------------------------------------------------------------ */
/*  Ribbon SVG component                                               */
/* ------------------------------------------------------------------ */

export default function RibbonDiagram({
  corridors,
  hoveredIdx,
  onHover,
}: {
  corridors: CorridorEntry[];
  hoveredIdx: number | null;
  onHover: (idx: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      if (width > 0) setContainerW(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodeCount = useMemo(() => {
    const src = new Set<string>();
    const dst = new Set<string>();
    for (const c of corridors) { src.add(c.srcCurrency); dst.add(c.dstCurrency); }
    return Math.max(src.size, dst.size, 1);
  }, [corridors]);

  const MIN_NODE_H = 24;
  const PAD_Y = 14;
  const w = containerW;
  const innerH = Math.max(200, nodeCount * (MIN_NODE_H + NODE_PAD));
  const h = innerH + PAD_Y * 2;
  const chartW = w;

  const data = useMemo(() => buildRibbonData(corridors, chartW, innerH), [corridors, chartW, innerH]);
  const particles = useParticleAnimation(data.ribbons.length, corridors);

  if (data.srcNodes.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <p className="font-mono text-body text-muted">No corridor data</p>
      </div>
    );
  }

  // Precompute ribbon center bezier params for particle positioning
  const ribbonCenters = data.ribbons.map((r) => {
    const x0 = NODE_WIDTH;
    const x1 = chartW - NODE_WIDTH;
    const cpOffset = (x1 - x0) * 0.45;
    const srcMidY = r.srcY + r.srcH / 2;
    const dstMidY = r.dstY + r.dstH / 2;
    return {
      x0, y0: srcMidY,
      cp1x: x0 + cpOffset, cp1y: srcMidY,
      cp2x: x1 - cpOffset, cp2y: dstMidY,
      x1, y1: dstMidY,
      color: r.color,
    };
  });

  return (
    <div ref={containerRef} className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }}>
        <g transform={`translate(0, ${PAD_Y})`}>
          {/* Ribbons */}
          {data.ribbons.map((r, i) => {
            const dimmed = hoveredIdx !== null && hoveredIdx !== i;
            return (
              <path
                key={i}
                d={r.path}
                fill={r.color}
                opacity={dimmed ? 0.08 : 0.35}
                stroke={r.color}
                strokeWidth={hoveredIdx === i ? 1.5 : 0.5}
                strokeOpacity={hoveredIdx === i ? 0.6 : 0.15}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                className="cursor-pointer transition-opacity duration-150"
              />
            );
          })}

          {/* Animated particles */}
          {particles.map((p) => {
            const rc = ribbonCenters[p.ribbonIdx];
            if (!rc) return null;
            const [cx, cy] = bezierPoint(rc.x0, rc.y0, rc.cp1x, rc.cp1y, rc.cp2x, rc.cp2y, rc.x1, rc.y1, p.progress);
            return (
              <circle key={p.id} cx={cx} cy={cy} r={3} fill={rc.color} opacity={p.opacity * 0.9}>
                <animate attributeName="r" values="2;4;2" dur="0.8s" repeatCount="indefinite" />
              </circle>
            );
          })}

          {/* Source nodes (left) */}
          {data.srcNodes.map((n) => (
            <rect key={`src-${n.currency}`} x={0} y={n.y} width={NODE_WIDTH} height={n.height} rx={2} fill={n.color} />
          ))}

          {/* Destination nodes (right) */}
          {data.dstNodes.map((n) => (
            <rect key={`dst-${n.currency}`} x={chartW - NODE_WIDTH} y={n.y} width={NODE_WIDTH} height={n.height} rx={2} fill={n.color} />
          ))}
        </g>

        {/* Source labels (right of left node bars) */}
        {data.srcNodes.map((n) => (
          <text
            key={`src-label-${n.currency}`}
            x={NODE_WIDTH + 8}
            y={PAD_Y + n.y + n.height / 2}
            textAnchor="start"
            dominantBaseline="middle"
            fill={n.color}
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="500"
          >
            {n.currency}
          </text>
        ))}

        {/* Destination labels (left of right node bars) */}
        {data.dstNodes.map((n) => (
          <text
            key={`dst-label-${n.currency}`}
            x={w - NODE_WIDTH - 8}
            y={PAD_Y + n.y + n.height / 2}
            textAnchor="end"
            dominantBaseline="middle"
            fill={n.color}
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="500"
          >
            {n.currency}
          </text>
        ))}
      </svg>
    </div>
  );
}
