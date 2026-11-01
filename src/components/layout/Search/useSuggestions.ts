import { useId, useMemo, useState } from "react";
import { type ListedToken, matchTokens, type TokenList } from "@/lib/token-list";

/** Tokens the list shows at once; past that, a row opens all of them. */
const SHOWN = 6;

/** What an option opens: a token, or every match (`/search/<text>`). */
export type Suggestion = ListedToken | "all";

/**
 * The search box as a combobox (APG, list autocomplete): the token
 * list's matches for what's typed, in a listbox under it. Arrows move
 * through them, Enter opens the active one, Escape closes the list.
 * Focus stays in the input throughout. Nothing is active until an
 * arrow says so, so Enter alone still submits what was typed.
 */
export function useSuggestions(list: TokenList | null, input: string, onPick: (s: Suggestion) => void) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = input.trim();
  const matches = useMemo(() => (list && q ? matchTokens(list.tokens, q) : []), [list, q]);
  const tokens = matches.slice(0, SHOWN);
  const options: Suggestion[] = matches.length > SHOWN ? [...tokens, "all"] : tokens;
  const expanded = open && options.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (options.length === 0) return;
      e.preventDefault();
      const n = options.length;
      if (!expanded) setOpen(true);
      else setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if (e.key === "Enter" && expanded && active >= 0) {
      e.preventDefault();
      onPick(options[active]);
      close();
    } else if (e.key === "Escape" && expanded) {
      // Only the list: a dialog around the box stays open.
      e.stopPropagation();
      close();
    }
  };

  return {
    listId,
    options,
    total: matches.length,
    expanded,
    active,
    optionId,
    /** A new input: the list shows again, with nothing active. */
    reset: () => {
      setOpen(true);
      setActive(-1);
    },
    inputProps: {
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": expanded,
      "aria-controls": expanded ? listId : undefined,
      "aria-activedescendant": expanded && active >= 0 ? optionId(active) : undefined,
      onKeyDown,
      onFocus: () => setOpen(true),
      onBlur: close,
    } as const,
    pick: (s: Suggestion) => {
      onPick(s);
      close();
    },
  };
}
