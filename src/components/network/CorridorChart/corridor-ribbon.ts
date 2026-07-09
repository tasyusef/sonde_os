import type { CorridorEntry } from "@/types/analytics";
import {
  CURRENCY_COLORS,
  CURRENCY_FALLBACK_PALETTE as FALLBACK_COLORS,
} from "@/lib/chart-colors";

export const NODE_PAD = 6;
export const NODE_WIDTH = 8;

export interface RibbonNode {
  currency: string;
  name: string | null;
  volume: number;
  y: number;
  height: number;
  color: string;
}

export interface Ribbon {
  src: RibbonNode;
  dst: RibbonNode;
  srcY: number;
  srcH: number;
  dstY: number;
  dstH: number;
  volume: number;
  entry: CorridorEntry;
  color: string;
  path: string;
}

export interface RibbonData {
  srcNodes: RibbonNode[];
  dstNodes: RibbonNode[];
  ribbons: Ribbon[];
}

export function getColor(currency: string, idx: number): string {
  return CURRENCY_COLORS[currency] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

export function buildRibbonData(
  corridors: CorridorEntry[],
  width: number,
  height: number,
): RibbonData {
  if (corridors.length === 0) return { srcNodes: [], dstNodes: [], ribbons: [] };

  // Accumulate volumes per side
  const srcMap = new Map<string, { name: string | null; volume: number }>();
  const dstMap = new Map<string, { name: string | null; volume: number }>();

  for (const c of corridors) {
    const s = srcMap.get(c.srcCurrency) ?? { name: c.srcName, volume: 0 };
    s.volume += c.xrpVolume;
    if (c.srcName) s.name = c.srcName;
    srcMap.set(c.srcCurrency, s);

    const d = dstMap.get(c.dstCurrency) ?? { name: c.dstName, volume: 0 };
    d.volume += c.xrpVolume;
    if (c.dstName) d.name = c.dstName;
    dstMap.set(c.dstCurrency, d);
  }

  // Sort by volume descending
  const srcSorted = [...srcMap.entries()].sort((a, b) => b[1].volume - a[1].volume);
  const dstSorted = [...dstMap.entries()].sort((a, b) => b[1].volume - a[1].volume);

  // Layout nodes vertically
  function layoutNodes(
    entries: [string, { name: string | null; volume: number }][],
  ): RibbonNode[] {
    const totalVolume = entries.reduce((s, [, v]) => s + v.volume, 0);
    if (totalVolume === 0) return [];
    const totalPad = NODE_PAD * (entries.length - 1);
    const availH = height - totalPad;
    let y = 0;
    return entries.map(([currency, { name, volume }], i) => {
      const h = Math.max(2, (volume / totalVolume) * availH);
      const node: RibbonNode = { currency, name, volume, y, height: h, color: getColor(currency, i) };
      y += h + NODE_PAD;
      return node;
    });
  }

  const srcNodes = layoutNodes(srcSorted);
  const dstNodes = layoutNodes(dstSorted);

  // Build ribbon paths — track consumption per node
  const srcConsumed = new Map<string, number>();
  const dstConsumed = new Map<string, number>();
  for (const n of srcNodes) srcConsumed.set(n.currency, n.y);
  for (const n of dstNodes) dstConsumed.set(n.currency, n.y);

  const srcLookup = new Map(srcNodes.map((n) => [n.currency, n]));
  const dstLookup = new Map(dstNodes.map((n) => [n.currency, n]));

  const ribbonX0 = NODE_WIDTH;
  const ribbonX1 = width - NODE_WIDTH;
  const cpOffset = (ribbonX1 - ribbonX0) * 0.45;

  const ribbons: Ribbon[] = [];

  for (const entry of corridors) {
    const sn = srcLookup.get(entry.srcCurrency);
    const dn = dstLookup.get(entry.dstCurrency);
    if (!sn || !dn) continue;

    const srcRatio = sn.volume > 0 ? entry.xrpVolume / sn.volume : 0;
    const dstRatio = dn.volume > 0 ? entry.xrpVolume / dn.volume : 0;
    const srcH = Math.max(1, srcRatio * sn.height);
    const dstH = Math.max(1, dstRatio * dn.height);

    const srcY = srcConsumed.get(entry.srcCurrency)!;
    srcConsumed.set(entry.srcCurrency, srcY + srcH);

    const dstY = dstConsumed.get(entry.dstCurrency)!;
    dstConsumed.set(entry.dstCurrency, dstY + dstH);

    // Cubic bezier ribbon path
    const x0 = ribbonX0;
    const x1 = ribbonX1;
    const cp1x = x0 + cpOffset;
    const cp2x = x1 - cpOffset;

    const path = [
      `M ${x0} ${srcY}`,
      `C ${cp1x} ${srcY}, ${cp2x} ${dstY}, ${x1} ${dstY}`,
      `L ${x1} ${dstY + dstH}`,
      `C ${cp2x} ${dstY + dstH}, ${cp1x} ${srcY + srcH}, ${x0} ${srcY + srcH}`,
      "Z",
    ].join(" ");

    ribbons.push({ src: sn, dst: dn, srcY, srcH, dstY, dstH, volume: entry.xrpVolume, entry, color: sn.color, path });
  }

  return { srcNodes, dstNodes, ribbons };
}

/** Get a point along a cubic bezier at t (0→1) */
export function bezierPoint(
  x0: number, y0: number,
  cp1x: number, cp1y: number,
  cp2x: number, cp2y: number,
  x1: number, y1: number,
  t: number,
): [number, number] {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    mt3 * x0 + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * x1,
    mt3 * y0 + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * y1,
  ];
}
