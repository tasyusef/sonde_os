import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BRAND, GROUND } from "@/lib/brand-colors";
import { oklchToHex, oklchToRgb } from "@/lib/oklch";
import { TX_COLOR_KEYS } from "@/lib/xrpl-helpers";

/* Checks the shipped tokens, not copies: reads globals.css and measures
   coloured text against the tints and surfaces it actually sits on, in both
   themes, and in light mode on wide-gamut screens too. */

type Rgba = [r: number, g: number, b: number, a: number];

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function tokens(block: RegExp): Record<string, string> {
  const body = css.match(block)?.[1];
  if (body === undefined) throw new Error(`globals.css: no block matching ${block}`);
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
}

const inlineTheme = tokens(/@theme inline \{([^}]*)\}/);
const darkTheme = tokens(/@theme \{([^}]*)\}/);
const lightTheme = { ...darkTheme, ...tokens(/html\.light \{([^}]*)\}/) };
const p3Theme = { ...lightTheme, ...tokens(/@media \(color-gamut: p3\) \{\s*html\.light \{([^}]*)\}/) };
const themes = { dark: darkTheme, light: lightTheme, "light P3": p3Theme };
const allThemes = ["dark", "light", "light P3"] as const;

/** sRGB's transfer back to linear, extended past 0-1 as CSS Color 4 does,
 *  so a P3 colour outside sRGB still has the right luminance. */
const decode = (v: number) => Math.sign(v) * (Math.abs(v) <= 0.04045 ? Math.abs(v) / 12.92 : ((Math.abs(v) + 0.055) / 1.055) ** 2.4);

function parseColor(value: string | undefined): Rgba {
  if (!value) throw new Error("missing colour token");
  const hex = value.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    const n = (i: number) => parseInt(hex[1].slice(i, i + 2), 16);
    return [n(0), n(2), n(4), hex[2] ? parseInt(hex[2], 16) / 255 : 1];
  }
  const lch = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/);
  if (lch) {
    const [l, c, h, a] = lch.slice(1).map((v) => (v === undefined ? 1 : Number(v)));
    return [...oklchToRgb(l, c, h), a];
  }
  throw new Error(`unsupported colour: ${value}`);
}

/** Source-over in sRGB, as browsers blend. The result is opaque. */
function over([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  return 0.2126 * decode(r / 255) + 0.7152 * decode(g / 255) + 0.0722 * decode(b / 255);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The grounds coloured text and tags sit on: the page, a card, an elevated
 *  panel and a hovered row. */
function grounds(t: Record<string, string>): Record<string, Rgba> {
  const surface = parseColor(t["--color-surface"]);
  return {
    page: parseColor(t["--color-black"]),
    surface,
    elevated: parseColor(t["--color-elevated"]),
    "row hover": over(parseColor(t["--color-row-hover"]), surface),
  };
}

describe("contrast helpers", () => {
  it("matches known WCAG ratios", () => {
    expect(contrast(parseColor("#000000"), parseColor("#FFFFFF"))).toBeCloseTo(21, 5);
    expect(contrast(parseColor("#777777"), parseColor("#FFFFFF"))).toBeCloseTo(4.48, 2);
  });

  it("reads OKLCH as the sRGB it renders", () => {
    const [r, g, b, a] = parseColor("oklch(0.871 0.185 100 / 0.5)");
    expect([r, g, b].map((v) => Math.max(0, Math.round(v)))).toEqual([0xf2, 0xd6, 0]);
    expect(a).toBe(0.5);
  });

  it("composites alpha over an opaque background", () => {
    expect(over([0, 0, 0, 0.5], parseColor("#FFFFFF"))).toEqual([127.5, 127.5, 127.5, 1]);
    expect(parseColor("#FFFFFF0F")[3]).toBeCloseTo(15 / 255, 6);
  });
});

/** Every hue a tag can take: the tx families and the statuses. */
const TAG_HUES = [
  ...TX_COLOR_KEYS.map((key) => [key, inlineTheme[`--color-tx-${key}`]] as const),
  ...(["success", "error", "warning"] as const).map((key) => [key, inlineTheme[`--color-status-${key}`]] as const),
];

describe("hues", () => {
  it.each(TX_COLOR_KEYS)("%s is its own text colour on the dark ground", (key) => {
    expect(darkTheme[`--color-tx-${key}-fg`]).toBe(inlineTheme[`--color-tx-${key}`]);
  });

  it.each(["success", "error", "warning"])("%s is its own text colour on the dark ground", (key) => {
    expect(darkTheme[`--color-${key}`]).toBe(inlineTheme[`--color-status-${key}`]);
  });
});

describe("tags", () => {
  /* `tag-*`: the hue as text on a 10% tint of itself on the dark ground,
     the hue as the fill with ink on it on paper. */
  it.each(TAG_HUES)("%s reads as text on its tint in dark mode", (key, value) => {
    const hue = parseColor(value);
    for (const [name, ground] of Object.entries(grounds(darkTheme))) {
      const ratio = contrast(hue, over([hue[0], hue[1], hue[2], 0.1], ground));
      expect(ratio, `${key} on ${name}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(TAG_HUES)("%s carries ink as a fill in light mode", (key, value) => {
    const ratio = contrast(parseColor(lightTheme["--color-on-accent"]), parseColor(value));
    expect(ratio, `ink on ${key}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("text in a hue", () => {
  /* Statuses as text: plain and on their own tints (hovers use 10%). The tx
     families' -fg tokens as plain text. */
  const statuses = ["success", "error", "warning"].flatMap((key) =>
    allThemes.map((theme) => [`--color-${key}`, theme, [0, 0.05, 0.08, 0.1]] as const),
  );
  const families = TX_COLOR_KEYS.flatMap((key) => allThemes.map((theme) => [`--color-tx-${key}-fg`, theme, [0]] as const));

  it.each([...statuses, ...families])("%s reaches 4.5:1 in %s mode", (token, theme, tints) => {
    const t = themes[theme];
    const fg = parseColor(t[token]);
    for (const [name, ground] of Object.entries(grounds(t))) {
      for (const tint of tints) {
        const ratio = contrast(fg, over([fg[0], fg[1], fg[2], tint], ground));
        expect(ratio, `${token} on ${name} + ${tint * 100}%: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(allThemes)("on-fill text reaches 4.5:1 on accent and error fills in %s mode", (theme) => {
    const t = themes[theme];
    for (const fill of ["accent", "error"]) {
      const ratio = contrast(parseColor(t[`--color-on-${fill}`]), parseColor(t[`--color-${fill}`]));
      expect(ratio, `on-${fill}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("marks in a hue", () => {
  /* Dots, bars and candles are graphics, so 3:1 (WCAG 1.4.11) on the
     grounds they sit on, the page and a card. */
  const marks = [
    ...(["success", "error"] as const).map((key) => [`--color-${key}-mark`, `--color-status-${key}`] as const),
    ...TX_COLOR_KEYS.map((key) => [`--color-tx-${key}-mark`, `--color-tx-${key}`] as const),
  ];

  it.each(marks)("%s is its hue on the dark ground", (token, hue) => {
    expect(darkTheme[token]).toBe(inlineTheme[hue]);
  });

  it.each(marks.flatMap(([token]) => allThemes.map((theme) => [token, theme] as const)))(
    "%s reaches 3:1 in %s mode",
    (token, theme) => {
      const t = themes[theme];
      const mark = parseColor(t[token]);
      const { page, surface } = grounds(t);
      for (const [name, ground] of Object.entries({ page, surface })) {
        const ratio = contrast(mark, ground);
        expect(ratio, `${token} on ${name}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    },
  );
});

describe("muted text", () => {
  /* Labels and metadata; muted is the dimmest type, so it sets the floor. */
  it.each(allThemes)("reaches 4.5:1 on every ground in %s mode", (theme) => {
    const t = themes[theme];
    const muted = parseColor(t["--color-muted"]);
    for (const [name, ground] of Object.entries(grounds(t))) {
      const ratio = contrast(muted, ground);
      expect(ratio, `muted on ${name}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("brand hex", () => {
  /* The copies in lib/brand-colors (theme-color, manifest, icons). */
  it("matches the page in each theme and the coral", () => {
    expect(oklchToHex(darkTheme["--color-black"])).toBe(GROUND.dark);
    expect(oklchToHex(lightTheme["--color-black"])).toBe(GROUND.light);
    expect(oklchToHex(darkTheme["--color-brand"])).toBe(BRAND);
    expect(lightTheme["--color-brand"]).toBe(darkTheme["--color-brand"]);
  });
});
