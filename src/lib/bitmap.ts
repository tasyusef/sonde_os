/** Turns a bitmap drawn as strings (`#` on, anything else off) into an
 *  SVG path of one rect per horizontal run, offset by `x0` cells. With
 *  `shape-rendering="crispEdges"` and a whole-pixel scale per cell, it
 *  draws as sharp as the pixel fonts. */
export function bitmapPath(rows: readonly string[], x0 = 0): string {
  let d = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "#") {
        x++;
        continue;
      }
      const start = x;
      while (row[x] === "#") x++;
      d += `M${start + x0} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  return d;
}
