import { motion } from "motion/react";
import { slideDownVariants, SPRING } from "@/lib/motion";
import { tokenId } from "@/lib/token-id";
import { cn } from "@/lib/utils";
import { truncate } from "@/lib/xrpl-helpers";
import type { Suggestion, useSuggestions } from "./useSuggestions";

/**
 * The listbox under the search box (`useSuggestions`): a token per row,
 * ticker and name at the left, its issuer at the right, since a ticker
 * alone doesn't say which of its copies it is. `inFlow` sets it in the
 * page instead of over it (the mobile search sheet, above the field),
 * on the ground with no box, scrolling when the keyboard leaves it
 * little room; that's a layout change, so it doesn't animate.
 */
export default function Suggestions({
  suggestions: s,
  inFlow,
}: {
  suggestions: ReturnType<typeof useSuggestions>;
  inFlow?: boolean;
}) {
  if (!s.expanded) return null;
  return (
    <motion.ul
      id={s.listId}
      role="listbox"
      aria-label="Tokens"
      variants={slideDownVariants}
      initial={inFlow ? false : "hidden"}
      animate="visible"
      transition={SPRING.pop}
      className={cn(
        "flex flex-col py-1",
        inFlow ? "min-h-0 overflow-y-auto" : "absolute inset-x-0 top-full z-50 mt-1.5 bg-surface shadow-card",
      )}
    >
      {s.options.map((option, i) => (
        // The keyboard reaches options through the input
        // (`aria-activedescendant`), as a combobox's do.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <li
          key={option === "all" ? "all" : tokenId(option.ref)}
          id={s.optionId(i)}
          role="option"
          aria-selected={i === s.active}
          // Keeps focus in the input, so the list doesn't close first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => s.pick(option)}
          className={cn(
            "group flex cursor-pointer items-baseline gap-3 px-3 py-2 hover:bg-primary hover:text-black",
            i === s.active ? "bg-primary text-black" : "text-primary",
          )}
        >
          <Row option={option} total={s.total} active={i === s.active} />
        </li>
      ))}
    </motion.ul>
  );
}

function Row({ option, total, active }: { option: Suggestion; total: number; active: boolean }) {
  if (option === "all") {
    return <span className="font-display text-caps uppercase">See all {total.toLocaleString()}</span>;
  }
  const quiet = cn("font-mono text-label", active ? "text-black" : "text-muted group-hover:text-black");
  return (
    <>
      <span className="shrink-0 font-mono text-cell">{option.ticker}</span>
      <span className={cn("min-w-0 flex-1 truncate", quiet)}>{option.name}</span>
      <span className={cn("max-w-[45%] shrink-0 truncate", quiet)}>
        {option.issuerName ?? option.domain ?? truncate(option.issuer)}
      </span>
    </>
  );
}
