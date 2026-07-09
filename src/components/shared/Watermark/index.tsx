import { SondeMark, SondeWordmark } from "@/components/shared/SondeLogo";

/**
 * Sonde brand mark + wordmark in the corner of chart cards. Tim's
 * redesign — was previously a 3%-opacity centered mark behind the
 * chart content; now reads as a clear (full-opacity, muted-color)
 * brand tag in the corner, like the logo on a press card. Parent
 * must be `position: relative`.
 *
 * Default position is top-right. Pass `placement="bottom-right"` on
 * cards where the top-right corner of the body is already busy with
 * chart content (e.g. CorridorChart's ribbon labels) — the bottom
 * corner is empty pixels there.
 */
type WatermarkPlacement = "top-right" | "bottom-right";

export default function Watermark({
  placement = "top-right",
}: {
  placement?: WatermarkPlacement;
}) {
  const positionClass =
    placement === "bottom-right" ? "bottom-3 right-3" : "top-3 right-3";
  return (
    <div
      className={`pointer-events-none absolute ${positionClass} z-10 flex items-center gap-1.5 text-muted`}
    >
      <SondeMark size={14} />
      <SondeWordmark height={10} />
    </div>
  );
}

export { Watermark };
