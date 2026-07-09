/**
 * Spinner — small inline loading indicator.
 *
 * Token-driven (uses `currentColor`) so callers can tint via parent
 * `text-*` class. Defaults to 12×12 — sized to sit beside `text-tag`
 * (10px) and `text-label` (12px) without dominating. For larger
 * contexts pass a `size` prop or wrap with explicit width/height.
 *
 * `animate-spin` is the Tailwind built-in — no custom keyframes.
 */
interface SpinnerProps {
  /** Pixel size — width and height. Defaults to 12. */
  size?: number;
  className?: string;
}

export default function Spinner({ size = 12, className = "" }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`shrink-0 animate-spin ${className}`}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export { Spinner };
