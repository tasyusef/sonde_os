import { useEffect, useRef } from "react";
import { type Theme, useTheme } from "@/hooks/useTheme";
import { CELL } from "@/lib/pixel-chart";

/** A colour token per palette index; index 0 stays clear. */
export type Palette = readonly string[];

/** Each token's RGBA, as the canvas reads it in the current theme. */
function resolve(palette: Palette, el: Element): Uint8ClampedArray[] {
  const style = getComputedStyle(el);
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  return palette.map((token) => {
    if (!probe || !token) return new Uint8ClampedArray(4);
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = style.getPropertyValue(token).trim();
    probe.fillRect(0, 0, 1, 1);
    return probe.getImageData(0, 0, 1, 1).data;
  });
}

/**
 * Paints one palette index per cell: the canvas is `cols × rows` pixels,
 * drawn at `CELL` CSS pixels each and scaled without smoothing, so every
 * cell lands as a hard square. Repaints when the theme swaps the tokens.
 */
export default function PixelCanvas({
  cells,
  cols,
  rows,
  palette,
}: {
  cells: Uint8Array;
  cols: number;
  rows: number;
  palette: Palette;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const colors = useRef<{ theme: Theme; palette: Palette; rgba: Uint8ClampedArray[] } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (colors.current?.theme !== theme || colors.current.palette !== palette) {
      colors.current = { theme, palette, rgba: resolve(palette, canvas) };
    }
    const { rgba } = colors.current;
    const image = ctx.createImageData(cols, rows);
    for (let i = 0; i < cells.length; i++) if (cells[i]) image.data.set(rgba[cells[i]], i * 4);
    ctx.putImageData(image, 0, 0);
  }, [cells, cols, rows, palette, theme]);

  return (
    <canvas
      ref={ref}
      width={cols}
      height={rows}
      aria-hidden="true"
      className="absolute top-0 left-0 [image-rendering:pixelated]"
      style={{ width: cols * CELL, height: rows * CELL }}
    />
  );
}
