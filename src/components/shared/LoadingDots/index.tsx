/**
 * LoadingDots — three bouncing dots in a wave.
 *
 * For prominent in-progress states where the small inline Spinner
 * feels too quiet — e.g. the Transactions tab's "Loaded N of M…"
 * counter during paginated fetches, or the NFTs tab's "Resolved 240
 * of 800…" progressive loader. Each dot scales + fades through the
 * `loading-dot` keyframe (defined in globals.css); 200ms staggered
 * delays produce the wave.
 *
 * Tinted via `currentColor` like Spinner — caller controls color
 * with the parent `text-*` class.
 */
interface LoadingDotsProps {
  /** Pixel size — width/height of each dot. Defaults to 6. */
  size?: number;
  /** Pixel gap between dots. Defaults to 4. */
  gap?: number;
  className?: string;
}

export default function LoadingDots({
  size = 6,
  gap = 4,
  className = "",
}: LoadingDotsProps) {
  const dotStyle = { width: `${size}px`, height: `${size}px` };
  return (
    <span
      className={`inline-flex items-center ${className}`}
      style={{ gap: `${gap}px` }}
      aria-hidden="true"
    >
      <span
        className="bg-current animate-loading-dot"
        style={dotStyle}
      />
      <span
        className="bg-current animate-loading-dot"
        style={{ ...dotStyle, animationDelay: "200ms" }}
      />
      <span
        className="bg-current animate-loading-dot"
        style={{ ...dotStyle, animationDelay: "400ms" }}
      />
    </span>
  );
}

export { LoadingDots };
