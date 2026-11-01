import { formatDropsAsXrp, parseDrops } from "@/lib/format";
import { cn } from "@/lib/utils";

/** An XRP amount from drops: exact, grouped ("1,234.5 XRP"). Renders
 *  nothing when `drops` isn't a whole number. */
export function AmountDisplay({
  drops,
  showSign = false,
  className,
}: {
  drops: string | number;
  showSign?: boolean;
  className?: string;
}) {
  // BigInt, not Number: a float loses drops above ~9 billion XRP.
  const d = parseDrops(drops);
  if (d === null) return null;
  const xrp = formatDropsAsXrp(d < 0n ? -d : d);

  let prefix = "";
  let colorClass = "text-primary";

  if (showSign && d > 0n) {
    prefix = "+";
    colorClass = "text-success";
  } else if (showSign && d < 0n) {
    prefix = "\u2212";
    colorClass = "text-error";
  }

  return (
    <span className={cn("font-mono text-cell tabular-nums", colorClass, className)}>
      {prefix}
      {xrp}
      <span className="ml-1 text-muted">XRP</span>
    </span>
  );
}

export default AmountDisplay;
