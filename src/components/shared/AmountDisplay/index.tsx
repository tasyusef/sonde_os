import { dropsToXrp } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";

export function AmountDisplay({
  drops,
  showSign = false,
  className,
}: {
  drops: string | number;
  showSign?: boolean;
  className?: string;
}) {
  const num = Number(drops);
  if (!Number.isFinite(num)) return null;
  const xrp = dropsToXrp(Math.abs(num).toString());

  let prefix = "";
  let colorClass = "text-primary";

  if (showSign && num > 0) {
    prefix = "+";
    colorClass = "text-success";
  } else if (showSign && num < 0) {
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
