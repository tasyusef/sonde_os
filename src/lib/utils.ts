import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** Every `--text-*` size token in globals.css. tailwind-merge only knows
 *  Tailwind's own sizes, so it reads any other `text-*` as a colour: a
 *  size missing here knocks out the colour beside it (`text-caps` would
 *  drop `text-on-accent`). utils.test.ts checks the list against the CSS. */
export const TEXT_SIZES = [
  "micro",
  "label",
  "tag",
  "caps",
  "cell",
  "ui",
  "body",
  "lg",
  "value",
  "heading",
  "title",
  "display",
  "display-lg",
  "figure",
  "figure-lg",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TEXT_SIZES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Copy text to clipboard with fallback for restricted contexts. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback: temporary textarea + execCommand for iframes / unfocused contexts
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
