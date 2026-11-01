import type { ReactNode } from "react";
import PixelIcon from "@/components/shared/PixelIcon";
import { cn } from "@/lib/utils";

/**
 * The search box, in every variant: a dither field with no edge and
 * the submit block at its right end. Submit is disabled only for empty
 * input, a muted mark on the dither; anything else reaches
 * `handleSubmit`, which routes or explains what's wrong. An error
 * shows as its message by the field.
 */
export function SearchField({
  hasInput,
  className,
  children,
}: {
  /** Trimmed input is non-empty. Empty input is the only no-op submit. */
  hasInput: boolean;
  className?: string;
  /** The `<input>` itself, owned by `UnifiedSearch`. */
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-stretch overflow-hidden bg-dither has-[input:focus-visible]:focus-ring",
        className,
      )}
    >
      {children}
      <button
        type="submit"
        disabled={!hasInput}
        aria-label="Submit search"
        className="flex shrink-0 items-center justify-center bg-accent px-4 text-on-accent outline-on-accent -outline-offset-4 enabled:hover:bg-primary enabled:hover:text-black disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted"
      >
        <PixelIcon name="search" />
      </button>
    </div>
  );
}
