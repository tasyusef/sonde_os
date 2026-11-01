import { WORDMARK_H, WORDMARK_PATHS, WORDMARK_W } from "@/lib/logo";

export function SondeWordmark({
  scale = 1,
  className,
}: {
  /** Device-independent pixels per cell; keep it whole. */
  scale?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${WORDMARK_W} ${WORDMARK_H}`}
      width={WORDMARK_W * scale}
      height={WORDMARK_H * scale}
      fill="currentColor"
      shapeRendering="crispEdges"
      className={className}
    >
      {WORDMARK_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
