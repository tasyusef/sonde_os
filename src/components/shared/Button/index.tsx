"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import {
  HOVER_SCALE,
  ICON_HOVER_SCALE,
  ICON_TAP_SCALE,
  SPRING,
  TAP_SCALE,
} from "@/lib/motion";
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

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white shadow-card hover:bg-brand-light hover:shadow-card-hover",
  secondary:
    "bg-elevated text-primary hover:bg-elevated/80",
  ghost:
    "text-muted hover:text-primary hover:bg-elevated",
  outline:
    "border border-elevated bg-transparent text-secondary hover:border-brand/30 hover:text-primary",
  danger:
    "bg-error text-white hover:bg-error/90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1 text-label",
  md: "px-4 py-2 text-ui",
  lg: "px-5 py-2.5 text-ui",
};

const ICON_ONLY_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "p-1",
  md: "p-2",
  lg: "p-2.5",
};

const BASE_CLASSES =
  // `min-h-[var(--ctrl-h-*)]` aligns Buttons with Toggle/Input heights
  // in shared rows. The min-h floor lets `lg`/`iconOnly` variants stay
  // taller while smaller variants get bumped up to the touch-friendly
  // 36px on mobile.
  "inline-flex min-h-[var(--ctrl-h-mobile)] sm:min-h-[var(--ctrl-h-desktop)] items-center justify-center gap-2 rounded-xl font-display font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Get the full className string for a Button style without rendering a <button>.
 * Useful for applying button styling to a Next.js <Link> or any non-button element.
 *
 * Note: this helper does NOT apply the motion scale animation — those only
 * exist on the motion.button rendered by <Button>. Link-styled buttons get
 * the same look but without the press feedback.
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
    iconOnly ? ICON_ONLY_SIZE_CLASSES[size] : SIZE_CLASSES[size],
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
 * Variants:
 * - primary: brand-filled, for main CTAs (Launch Explorer, Subscribe, Save)
 * - secondary: elevated background, for secondary actions
 * - ghost: transparent, for compact/inline icon buttons (close, settings)
 * - outline: bordered, for tertiary actions (Cancel, Load More)
 * - danger: error-filled, for destructive actions (Delete, Remove)
 *
 * For navigation, wrap in Next.js <Link> or use `buttonClasses()` on the Link directly.
 *
 * Includes subtle Framer Motion scale feedback on hover and tap. Disabled
 * and loading states skip the animations.
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

  // Icon-only buttons get slightly more feedback since they have less visual mass
  const hoverScale = iconOnly ? ICON_HOVER_SCALE : HOVER_SCALE;
  const tapScale = iconOnly ? ICON_TAP_SCALE : TAP_SCALE;

  const motionProps: HTMLMotionProps<"button"> = isDisabled
    ? {}
    : {
        // Hover uses the quick, very damped `snap` — instant lift, no
        // post-hover wobble. Tap uses the bouncier `pop` so the release
        // overshoots past scale 1.0 before settling — that overshoot is
        // the "stretch" half of squash-and-stretch.
        whileHover: { scale: hoverScale, transition: SPRING.snap },
        whileTap: { scale: tapScale, transition: SPRING.pop },
      };

  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        buttonClasses({ variant, size, iconOnly, fullWidth }),
        loading && "cursor-wait",
        className,
      )}
      {...motionProps}
      {...(props as HTMLMotionProps<"button">)}
    >
      {loading ? <Spinner /> : leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
      {children}
      {!loading && rightIcon && (
        <span className="inline-flex shrink-0">{rightIcon}</span>
      )}
    </motion.button>
  );
});

export default Button;
