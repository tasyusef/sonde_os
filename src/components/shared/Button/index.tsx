import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square padding, meant for single-icon buttons. Requires aria-label. */
  iconOnly?: boolean;
  /** Shows spinner and disables click. */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

// Every variant reached for becomes a block of the text colour (the
// Toolbox convention); only the resting fill differs. The primary action
// also steps one nudge to the right. `not-disabled:`, not `enabled:`, so
// the same classes work on a Link (`:enabled` only matches form controls).
const REACHED = "not-disabled:hover:bg-primary not-disabled:hover:text-black";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: cn("bg-accent text-on-accent motion-safe:not-disabled:hover:translate-x-nudge", REACHED),
  secondary: cn("bg-dither text-primary", REACHED),
  ghost: cn("text-muted", REACHED),
  outline: cn("shadow-card text-primary", REACHED),
  danger: cn("bg-error text-on-error", REACHED),
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1 text-caps",
  md: "px-4 py-2 text-caps",
  lg: "px-5 py-2.5 text-caps",
};

// Icon-only buttons are square at the control floor.
const ICON_ONLY_BASE = "min-w-[var(--ctrl-h-mobile)] sm:min-w-[var(--ctrl-h-desktop)]";

const ICON_ONLY_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "p-1",
  md: "p-2",
  lg: "p-2.5",
};

const BASE_CLASSES =
  // The `--ctrl-h-mobile` / `--ctrl-h-desktop` min-height aligns Buttons with Toggle/Input heights
  // in shared rows. The min-h floor lets `lg`/`iconOnly` variants stay
  // taller while smaller variants get bumped up to the touch-friendly
  // 36px on mobile.
  "inline-flex min-h-[var(--ctrl-h-mobile)] sm:min-h-[var(--ctrl-h-desktop)] items-center justify-center gap-2 font-display uppercase disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Get the full className string for a Button style without rendering a <button>.
 * Useful for applying button styling to a React Router <Link> or any non-button element.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  iconOnly = false,
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cn(
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    iconOnly ? cn(ICON_ONLY_BASE, ICON_ONLY_SIZE_CLASSES[size]) : SIZE_CLASSES[size],
    fullWidth && "w-full",
    className,
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-4 w-4 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/**
 * Universal button primitive. Every button on the site should use this.
 *
 * Variants (each inverts to a text-colour block when reached for):
 * - primary: the accent block, for main CTAs (Launch Explorer, Subscribe, Save)
 * - secondary: the dither, for secondary actions
 * - ghost: bare, for compact/inline icon buttons (close, settings)
 * - outline: a 1px rim, for tertiary actions (Cancel, Load More)
 * - danger: error-filled, for destructive actions (Delete, Remove)
 *
 * For navigation, wrap in a React Router <Link> or use `buttonClasses()` on the Link directly.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    iconOnly = false,
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    className,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        buttonClasses({ variant, size, iconOnly, fullWidth }),
        loading && "cursor-wait",
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
      {children}
      {!loading && rightIcon && (
        <span className="inline-flex shrink-0">{rightIcon}</span>
      )}
    </button>
  );
});

export default Button;
