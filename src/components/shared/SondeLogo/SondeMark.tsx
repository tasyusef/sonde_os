import type { SVGProps } from "react";
import { MARK_PATH, MARK_SIZE } from "@/lib/logo";

/** `scale` is device-independent pixels per cell; keep it whole so the
 *  cells land on the pixel grid. Decorative by default (`aria-hidden`).
 *  Standing alone, as the only content of a link or button, pass
 *  `aria-label` and it becomes an `img` with that name. */
export function SondeMark({
  scale = 1,
  ...props
}: { scale?: number } & SVGProps<SVGSVGElement>) {
  const named = props["aria-label"] != null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
      width={MARK_SIZE * scale}
      height={MARK_SIZE * scale}
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden={named ? undefined : true}
      role={named ? "img" : undefined}
      {...props}
    >
      <path d={MARK_PATH} />
    </svg>
  );
}
