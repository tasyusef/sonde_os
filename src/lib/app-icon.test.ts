import { describe, expect, it } from "vitest";
import { drawIcon, iconLayout } from "./app-icon";
import { BRAND, GROUND } from "./brand-colors";
import { MARK, MARK_SMALL } from "./logo";
import { hexToRgb } from "./oklch";

const SIZES = [16, 32, 48, 180, 192, 512];

describe("iconLayout", () => {
  it.each([
    [16, MARK_SMALL, 1, 1],
    [32, MARK_SMALL, 2, 3],
    [48, MARK_SMALL, 3, 4],
    [180, MARK, 5, 37],
    [192, MARK, 5, 43],
    [512, MARK, 15, 98],
  ])("%ipx: %#", (size, mark, cell, at) => {
    expect(iconLayout(size)).toEqual({ mark, cell, at });
  });

  it("leaves at least a pixel of ground each side", () => {
    for (const size of SIZES) {
      const { mark, cell, at } = iconLayout(size);
      expect(at).toBeGreaterThanOrEqual(1);
      expect(at + cell * mark.length).toBeLessThanOrEqual(size - 1);
    }
  });

  it("keeps every inked pixel inside a maskable icon's safe circle", () => {
    for (const size of [192, 512]) {
      const { mark, cell, at } = iconLayout(size);
      const c = size / 2;
      mark.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch !== "#") return;
          const dx = Math.max(Math.abs(at + x * cell - c), Math.abs(at + (x + 1) * cell - c));
          const dy = Math.max(Math.abs(at + y * cell - c), Math.abs(at + (y + 1) * cell - c));
          expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(0.4 * size);
        });
      });
    }
  });
});

describe("drawIcon", () => {
  const pixel = (px: Uint8Array, size: number, x: number, y: number) =>
    [...px.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];

  it.each([32, 192])("draws the mark's cells in the yellow on the dark page (%ipx)", (size) => {
    const px = drawIcon(size);
    const { mark, cell, at } = iconLayout(size);
    for (let r = 0; r < mark.length; r++) {
      for (let c = 0; c < mark.length; c++) {
        const want = mark[r][c] === "#" ? BRAND : GROUND.dark;
        expect(pixel(px, size, at + c * cell + cell - 1, at + r * cell)).toEqual([...hexToRgb(want), 255]);
      }
    }
    expect(pixel(px, size, 0, 0)).toEqual([...hexToRgb(GROUND.dark), 255]);
    expect(pixel(px, size, size - 1, size - 1)).toEqual([...hexToRgb(GROUND.dark), 255]);
  });
});
