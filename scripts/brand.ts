/**
 * Draw Sonde's icons and share cards from the logo bitmaps (`lib/logo`)
 * and the tokens in globals.css, so they can't drift from the app.
 *
 * - Icons: drawn cell by cell (`lib/app-icon`), so every size is exact:
 *   favicon.ico (16, 32, 48), apple-icon.png (180), icon-192/512.png.
 * - Share cards (`public/og/*.png`, 1200×630): HTML set in the bitmap
 *   faces beside the home page's dithered globe, shot by headless Chrome.
 *
 * Usage:
 *   pnpm brand            (CHROME=/path/to/chrome if it isn't in /Applications)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LAND_RUNS } from "../src/components/home/Globe/land";
import { drawIcon } from "../src/lib/app-icon";
import { decodeRuns, globeFrame, globeView } from "../src/lib/globe";
import { drawArcs, liveArcs } from "../src/lib/globe-arcs";
import { MARK_PATH, MARK_SIZE, WORDMARK_H, WORDMARK_PATHS, WORDMARK_W } from "../src/lib/logo";
import { SHARE_DESCRIPTION } from "../src/lib/meta";
import { encodeIco, encodePng } from "../src/lib/png";

const root = resolve(import.meta.dirname, "..");
const pub = (file: string) => join(root, "public", file);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/* ——— Icons ——— */

const png = (size: number) => encodePng(size, size, drawIcon(size));
writeFileSync(pub("favicon.ico"), encodeIco([16, 32, 48].map((size) => ({ size, png: png(size) }))));
writeFileSync(pub("apple-icon.png"), png(180));
writeFileSync(pub("icon-192.png"), png(192));
writeFileSync(pub("icon-512.png"), png(512));

/* ——— Share cards ——— */

const W = 1200;
const H = 630;
/** Pixels per globe cell: coarser than the home page's 2, so the dither
 *  still reads when a feed shrinks the card to a third. */
const CELL = 3;
const COLS = W / CELL;
const ROWS = H / CELL;
/** The arcs' seed, as on the home page. */
const SEED = 7;

interface Card {
  file: string;
  /** One word: it has to clear the globe at 82.5px. Without one, the
   *  card is home's: the big lockup over the site's description. */
  title?: string;
  /** Seconds into the globe's turn: which face it shows, which arcs fly. */
  t: number;
}

const CARDS: Card[] = [
  { file: "home", t: 2 },
  { file: "network", title: "Network", t: 14 },
  { file: "docs", title: "Docs", t: 40 },
  { file: "support", title: "Support", t: 47 },
];

/** The dark theme's value for a token. */
const css = readFileSync(join(root, "src/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const darkTheme = css.match(/@theme \{([^}]*)\}/)?.[1] ?? "";
function token(name: string): string {
  const value = darkTheme.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`globals.css: no ${name} in @theme`);
  return value.trim();
}

const font = (file: string) =>
  `url(data:font/woff2;base64,${readFileSync(join(root, "src/fonts", file)).toString("base64")}) format("woff2")`;

const bitmap = (w: number, h: number, scale: number, paths: string[], color: string) =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" fill="${color}" shape-rendering="crispEdges">${paths
    .map((d) => `<path d="${d}"/>`)
    .join("")}</svg>`;

/** The mark and the wordmark, `scale` pixels a cell, 7 cells apart as
 *  in the footer. */
const lockup = (scale: number) =>
  `<div class="lockup" style="gap:${7 * scale}px">${bitmap(MARK_SIZE, MARK_SIZE, scale, [MARK_PATH], "var(--brand)")}${bitmap(
    WORDMARK_W,
    WORDMARK_H,
    scale,
    WORDMARK_PATHS,
    "var(--primary)",
  )}</div>`;

/** The globe at `t` as one byte a cell, base64: off the right edge, lit
 *  side toward the text, its halo about 60px clear of the longest line. */
const land = decodeRuns(LAND_RUNS);
const view = globeView(COLS, ROWS, 363, ROWS / 2, 110, null);
function globe(t: number): string {
  const frame = new Uint8Array(COLS * ROWS);
  globeFrame(frame, view, land, t);
  drawArcs(frame, view, liveArcs(t, land, SEED), t);
  return Buffer.from(frame).toString("base64");
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function cardHtml({ title, t }: Card): string {
  const head = title
    ? `${lockup(2)}<h1>${escape(title)}</h1>`
    : `<div></div><div>${lockup(5)}<p>${escape(SHARE_DESCRIPTION)}</p></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"PARC Pixel";src:${font("ParcPixel-Regular.woff2")};font-weight:100 500}
@font-face{font-family:"PARC Pixel";src:${font("ParcPixel-Bold.woff2")};font-weight:600 900}
@font-face{font-family:"Departure Mono";src:${font("DepartureMono-Regular.woff2")}}
:root{--ground:${token("--color-black")};--primary:${token("--color-primary")};--muted:${token("--color-muted")};--brand:${token("--color-brand")};--ink:${token("--color-rim-strong")}}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:var(--ground);color:var(--primary);-webkit-font-smoothing:none;font-synthesis:none}
canvas{position:absolute;inset:0;width:${W}px;height:${H}px;image-rendering:pixelated}
main{position:absolute;left:80px;top:72px;bottom:72px;width:620px;display:flex;flex-direction:column;justify-content:space-between}
.lockup{display:flex;align-items:center}
/* Bitmap sizes: PARC Bold is 13.75px to the em (82.5 = 6px a pixel),
   Regular 6.25 (25 = 4px), Departure Mono 11 (33 = 3px). */
h1{margin:0;font:700 82.5px/96px "PARC Pixel";text-transform:uppercase}
p{margin:40px 0 0;font:400 33px/40px "Departure Mono";max-width:29ch}
footer{font:400 25px/32px "PARC Pixel";color:var(--muted);text-transform:uppercase}
</style></head><body><canvas width="${COLS}" height="${ROWS}"></canvas><main>${head}<footer>sondelab.com</footer></main><script>
const frame = Uint8Array.from(atob("${globe(t)}"), (c) => c.charCodeAt(0));
const ctx = document.querySelector("canvas").getContext("2d");
const style = getComputedStyle(document.documentElement);
const fills = [null, style.getPropertyValue("--ink"), style.getPropertyValue("--brand")];
frame.forEach((v, i) => { if (v) { ctx.fillStyle = fills[v]; ctx.fillRect(i % ${COLS}, Math.floor(i / ${COLS}), 1, 1); } });
</script></body></html>`;
}

const work = mkdtempSync(join(tmpdir(), "sonde-brand-"));
try {
  for (const card of CARDS) {
    const html = join(work, `${card.file}.html`);
    writeFileSync(html, cardHtml(card));
    execFileSync(CHROME, [
      "--headless=new",
      `--user-data-dir=${join(work, "profile")}`,
      "--no-first-run",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${W},${H}`,
      "--virtual-time-budget=2000",
      `--screenshot=${pub(`og/${card.file}.png`)}`,
      `file://${html}`,
    ], { stdio: "ignore" });
    console.log(`og/${card.file}.png`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log("favicon.ico, apple-icon.png, icon-192.png, icon-512.png");
