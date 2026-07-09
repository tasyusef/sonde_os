import { getTypeColor, hexToRgb } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";

export function TypeTag({ txType, className }: { txType: string; className?: string }) {
  const color = getTypeColor(txType);
  const { r, g, b } = hexToRgb(color);

  return (
    <span
      className={cn(
        "inline-block rounded-tag px-2 py-0.5 font-mono text-tag font-medium whitespace-nowrap",
        className
      )}
      style={{
        "--tag-color": color,
        "--tag-bg": `rgba(${r}, ${g}, ${b}, 0.10)`,
        backgroundColor: "var(--tag-bg)",
        color: "var(--tag-color)",
      } as React.CSSProperties}
    >
      {txType}
    </span>
  );
}

export default TypeTag;
