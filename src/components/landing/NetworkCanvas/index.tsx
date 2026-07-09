"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

/* ——— Types ——— */
interface Node3D {
  x: number;
  y: number;
  z: number;
}

interface Edge {
  a: number;
  b: number;
}

interface Packet {
  edge: number;
  progress: number;
  speed: number;
  forward: boolean;
}

/* ——— Constants ——— */
const NODE_COUNT = 40;
const PACKET_COUNT = 16;
const FOV = 1200;
const ROTATION_SPEED = (Math.PI * 2) / 50; // full revolution in 50s
const RADIUS = 800;
const SPREAD_Z = 600;
const MAX_EDGE_DIST = 550;

/* ——— Helpers ——— */
function seededRandom(seed: number) {
  // Simple deterministic pseudo-random for consistent layout
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function project(node: Node3D, cx: number, cy: number): { sx: number; sy: number; scale: number } {
  const denom = Math.max(node.z + FOV + SPREAD_Z, 1);
  const scale = FOV / denom;
  return {
    sx: cx + node.x * scale,
    sy: cy + node.y * scale,
    scale,
  };
}

function rotateY(node: Node3D, angle: number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = node.x * cos - node.z * sin;
  const z = node.x * sin + node.z * cos;
  node.x = x;
  node.z = z;
}

function dist3D(a: Node3D, b: Node3D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/* ——— Init scene ——— */
function createScene() {
  const rand = seededRandom(42);

  // Generate nodes distributed inside a sphere
  const nodes: Node3D[] = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    // Spherical coordinates for uniform distribution
    const theta = rand() * Math.PI * 2;        // azimuth [0, 2π]
    const phi = Math.acos(2 * rand() - 1);     // polar [0, π] — uniform on sphere
    const r = RADIUS * Math.cbrt(rand());       // cube root for uniform volume fill
    nodes.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
    });
  }

  // Build edges: connect each node to 2–3 nearest neighbors (no duplicates)
  const edgeSet = new Set<string>();
  const edges: Edge[] = [];

  for (let i = 0; i < NODE_COUNT; i++) {
    const dists = nodes
      .map((n, j) => ({ j, d: j === i ? Infinity : dist3D(nodes[i], n) }))
      .filter((d) => d.d < MAX_EDGE_DIST)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);

    for (const { j } of dists) {
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ a: i, b: j });
      }
    }
  }

  // Create packets on random edges
  const packets: Packet[] = Array.from({ length: PACKET_COUNT }, () => ({
    edge: Math.floor(rand() * edges.length),
    progress: rand(),
    speed: 0.003 + rand() * 0.005,
    forward: rand() > 0.5,
  }));

  return { nodes, edges, packets };
}

/* ——— Component ——— */
export function NetworkCanvas() {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Read colors from CSS variables
    const style = getComputedStyle(document.documentElement);
    const brandColor = style.getPropertyValue("--color-brand").trim() || "#E8856C";


    const { nodes, edges, packets } = createScene();

    let frameId: number;
    let lastTime = 0;

    // Resize handler
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    // Animation loop
    const draw = (time: number) => {
      const dt = lastTime ? (time - lastTime) / 1000 : 0.016;
      lastTime = time;

      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Rotate nodes
      const angle = ROTATION_SPEED * dt;
      for (const node of nodes) rotateY(node, angle);

      // Project all nodes
      const projected = nodes.map((n) => project(n, cx, cy));

      // Draw edges (depth-sorted: back edges first)
      const sortedEdges = edges
        .map((e, i) => ({ ...e, i, avgZ: (nodes[e.a].z + nodes[e.b].z) / 2 }))
        .sort((a, b) => a.avgZ - b.avgZ);

      for (const edge of sortedEdges) {
        const pa = projected[edge.a];
        const pb = projected[edge.b];
        const depthAlpha = 0.04 + (1 - (edge.avgZ + SPREAD_Z) / (SPREAD_Z * 2)) * 0.12;

        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.strokeStyle = brandColor;
        ctx.globalAlpha = depthAlpha;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Draw nodes
      for (let i = 0; i < nodes.length; i++) {
        const p = projected[i];
        const depthAlpha = 0.1 + p.scale * 0.3;
        const radius = 2.5 + p.scale * 5;

        ctx.beginPath();
        ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = brandColor;
        ctx.globalAlpha = Math.min(depthAlpha, 0.35);
        ctx.fill();
      }

      // Advance and draw packets
      for (const pkt of packets) {
        pkt.progress += pkt.speed * (pkt.forward ? 1 : -1);

        // When packet reaches end, pick a new random edge
        if (pkt.progress >= 1 || pkt.progress <= 0) {
          pkt.edge = Math.floor(Math.random() * edges.length);
          pkt.progress = pkt.forward ? 0 : 1;
          pkt.forward = Math.random() > 0.5;
          pkt.speed = 0.003 + Math.random() * 0.005;
        }

        const edge = edges[pkt.edge];
        const pa = projected[edge.a];
        const pb = projected[edge.b];
        const t = pkt.progress;
        const px = pa.sx + (pb.sx - pa.sx) * t;
        const py = pa.sy + (pb.sy - pa.sy) * t;
        const pScale = pa.scale + (pb.scale - pa.scale) * t;

        // Glow
        ctx.beginPath();
        ctx.arc(px, py, 8 + pScale * 6, 0, Math.PI * 2);
        ctx.fillStyle = brandColor;
        ctx.globalAlpha = 0.04;
        ctx.fill();

        // Dot
        ctx.beginPath();
        ctx.arc(px, py, 2 + pScale * 3, 0, Math.PI * 2);
        ctx.fillStyle = brandColor;
        ctx.globalAlpha = 0.25 + pScale * 0.25;
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  if (reduced) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[2]"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

export default NetworkCanvas;
