// Tokens as hex, for the places CSS can't reach: the theme-color meta,
// the web manifest and the icons. `theme-contrast.test.ts` keeps each
// one equal to its token in globals.css.

/** The page (`--color-black`) in each theme. */
export const GROUND = { dark: "#11110E", light: "#F4F4F0" } as const;

/** The yellow (`--color-brand`), the same in both themes. */
export const BRAND = "#F2D600";
