import { useEffect, useId } from "react";
import { cn } from "@/lib/utils";
import { SearchField } from "./SearchField";
import Suggestions from "./Suggestions";
import { useUnifiedSearch } from "./useUnifiedSearch";

interface UnifiedSearchProps {
  /**
   * `topbar` is the persistent desktop bar. `hero` is the landing
   * page's, taller. `overlay` fills the mobile search sheet from the
   * bottom up: the field at its foot, the suggestions and any error
   * stacked above it, by the thumb and the keyboard.
   */
  variant?: "topbar" | "overlay" | "hero";
  /** Auto-focus the input on mount — used by the mobile overlay. */
  autoFocus?: boolean;
  /** Called after a successful submit so the host (overlay) can close. */
  onSubmit?: () => void;
}

/**
 * Global search form. One box takes an address, a transaction or ledger
 * hash, a ledger number, an NFT ID or a token by ticker, name, issuer or
 * ID; there's no type to pick (`lib/search`). Tokens it knows show in a
 * list under it as you type. Submit only no-ops on empty input;
 * anything else routes or says what it takes.
 */
export default function UnifiedSearch({
  variant = "topbar",
  autoFocus,
  onSubmit,
}: UnifiedSearchProps) {
  const errorId = useId();
  const { inputRef, input, hasInput, error, handleInput, handleSubmit, suggestions, inputProps } =
    useUnifiedSearch(onSubmit);
  const isOverlay = variant === "overlay";
  const isHero = variant === "hero";

  // Defer auto-focus to a macrotask so it lands AFTER any parent's
  // focus-trap initial-focus pass (which would otherwise grab the
  // overlay's Close button as the first focusable in DOM order).
  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [autoFocus, inputRef]);

  const inputEl = (
    <input
      ref={inputRef}
      type="text"
      value={input}
      onChange={(e) => handleInput(e.target.value)}
      {...inputProps}
      placeholder="Address, hash, ledger, NFT or token"
      aria-label="Search the XRP Ledger"
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
      // Addresses are case-sensitive; stop phones capitalising the `r`.
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="search"
      // Under 768px the global input rule in globals.css floors this at
      // 16px so iOS doesn't auto-zoom on focus.
      className={cn(
        "min-w-0 flex-1 bg-transparent font-body text-ui text-primary placeholder:text-muted outline-none",
        isHero || isOverlay ? "px-4" : "px-3",
      )}
    />
  );

  return (
    // The overlay sets the form last on screen but first in the DOM, so
    // the input still comes before its list for screen readers.
    <div className={isOverlay ? "flex min-h-0 flex-1 flex-col justify-end gap-2" : "relative w-full"}>
      <form onSubmit={handleSubmit} role="search" className={cn("w-full", isOverlay && "order-last")}>
        <SearchField hasInput={hasInput} className={isOverlay || isHero ? "h-12" : "h-10"}>
          {inputEl}
        </SearchField>
      </form>

      <Suggestions suggestions={suggestions} inFlow={isOverlay} />

      {error && (
        <p
          id={errorId}
          role="alert"
          className={cn("px-1 font-mono text-label text-error", !isOverlay && "mt-1.5")}
        >
          {error}
        </p>
      )}
    </div>
  );
}
