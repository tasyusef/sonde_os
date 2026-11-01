// The logo's bitmaps, shared by `components/shared/SondeLogo` and the
// icons and share cards `scripts/brand.ts` draws from them.
import { bitmapPath } from "./bitmap";

/** The probe: a ring on a stem inside a ring, on a 21-cell grid with the
 *  wordmark's 3-cell stroke. The inner ring is PARC Pixel Bold's O; the
 *  outer one cuts its corners the same way. */
export const MARK = [
  "..#################..",
  ".###################.",
  "#####################",
  "####.............####",
  "###...............###",
  "###....#######....###",
  "###...#########...###",
  "###..###########..###",
  "###..####...####..###",
  "###..###.....###..###",
  "###..###.....###..###",
  "###..###.....###..###",
  "###..####...####..###",
  "###..###########..###",
  "###...#########...###",
  "###....#######....###",
  "###......###......###",
  "####.....###.....####",
  "#####################",
  ".###################.",
  "..#################..",
] as const;
export const MARK_PATH = bitmapPath(MARK);
export const MARK_SIZE = MARK.length;

/** The mark redrawn for tab-size icons, where 21 cells won't fit or
 *  read: the same rings and stem on 13 cells, with a 2-cell stroke. */
export const MARK_SMALL = [
  ".###########.",
  "#############",
  "##.........##",
  "##..#####..##",
  "##.#######.##",
  "##.##...##.##",
  "##.##...##.##",
  "##.##...##.##",
  "##.#######.##",
  "##..#####..##",
  "##...###...##",
  "#############",
  ".###########.",
] as const;

/** "SONDE" in PARC Pixel Bold, traced from the font at a cell per font
 *  pixel: 11-cell caps, 3-cell stroke, letters 2 cells apart. */
const LETTERS = [
  [
    "..#########",
    ".##########",
    "###########",
    "####.......",
    "#########..",
    ".#########.",
    "..#########",
    ".......####",
    "###########",
    "##########.",
    "#########..",
  ],
  [
    "..#######..",
    ".#########.",
    "###########",
    "####...####",
    "###.....###",
    "###.....###",
    "###.....###",
    "####...####",
    "###########",
    ".#########.",
    "..#######..",
  ],
  [
    "###.....###",
    "####....###",
    "#####...###",
    "######..###",
    "#######.###",
    "###########",
    "###.#######",
    "###..######",
    "###...#####",
    "###....####",
    "###.....###",
  ],
  [
    "#########..",
    "##########.",
    "###########",
    "###....####",
    "###.....###",
    "###.....###",
    "###.....###",
    "###....####",
    "###########",
    "##########.",
    "#########..",
  ],
  [
    "###########",
    "###########",
    "###########",
    "###........",
    "#########..",
    "#########..",
    "#########..",
    "###........",
    "###########",
    "###########",
    "###########",
  ],
];
const ADVANCE = 13;
export const WORDMARK_PATHS = LETTERS.map((rows, i) => bitmapPath(rows, i * ADVANCE));
export const WORDMARK_W = LETTERS.length * ADVANCE - 2;
export const WORDMARK_H = LETTERS[0].length;
