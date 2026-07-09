import type { CSSProperties } from "react";

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function fmtUsd(n: number): string {
  if (n >= 100) {
    return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${n.toFixed(4)}`;
}

export function fmtUsdShort(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtModelName(model: string | null): string {
  if (!model) return "(legacy)";
  const haiku = model.match(/claude-haiku-(\d+)-(\d+)/);
  if (haiku) return `Haiku ${haiku[1]}.${haiku[2]}`;
  const sonnet = model.match(/claude-sonnet-(\d+)-(\d+)/);
  if (sonnet) return `Sonnet ${sonnet[1]}.${sonnet[2]}`;
  const opus = model.match(/claude-opus-(\d+)-(\d+)/);
  if (opus) return `Opus ${opus[1]}.${opus[2]}`;
  return model;
}

export const TICK_BOX: CSSProperties = {
  padding: "1px 6px",
  borderRadius: 3,
  background: "color-mix(in srgb, var(--color-surface) 75%, transparent)",
  fontSize: "var(--text-label)",
  fontFamily: "var(--font-mono)",
  color: "var(--color-muted)",
  lineHeight: "18px",
  whiteSpace: "nowrap",
};

interface TickProps {
  x?: string | number;
  y?: string | number;
  payload?: { value: string | number };
}

export function YTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) + 4} y={Number(y) - 10} width={80} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "inline-block" }}>{fmtNum(Number(payload.value))}</span>
    </foreignObject>
  );
}

export function XTick({ x, y, payload }: TickProps) {
  if (x == null || y == null || !payload) return null;
  return (
    <foreignObject x={Number(x) - 40} y={Number(y) + 4} width={80} height={20} style={{ overflow: "visible" }}>
      <span style={{ ...TICK_BOX, display: "block", textAlign: "center" }}>{fmtDate(String(payload.value))}</span>
    </foreignObject>
  );
}
