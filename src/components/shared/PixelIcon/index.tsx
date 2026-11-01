import { bitmapPath } from "@/lib/bitmap";
import { MARK_CELLS, MARKS, type MarkName } from "./marks";

const PATHS = Object.fromEntries(
  Object.entries(MARKS).map(([name, rows]) => [name, bitmapPath(rows)]),
) as Record<MarkName, string>;

/** Pixels a cell. `md` (18px) stands on its own: nav, icon buttons,
 *  badges. `sm` (9px, about a cap height) sits in a line of text, in
 *  the text's own one-pixel stroke: disclosure chevrons, ticks, inline
 *  buttons. */
const CELL = { md: 2, sm: 1 } as const;

/**
 * One of Sonde's drawn marks, in the colour of its text. Always
 * decorative: the control around it carries the name.
 */
export function PixelIcon({
  name,
  size = "md",
  className,
}: {
  name: MarkName;
  size?: keyof typeof CELL;
  className?: string;
}) {
  const px = MARK_CELLS * CELL[size];
  return (
    <svg
      viewBox={`0 0 ${MARK_CELLS} ${MARK_CELLS}`}
      width={px}
      height={px}
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export default PixelIcon;
