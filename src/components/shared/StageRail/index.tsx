import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The top of a detail page, laid out as Toolbox lays out a tool: the
 * subject on a stage, its facts in a rail beside it. Stacks stage-first
 * below `lg`. A page with nothing for the rail yet (an error) leaves it
 * out and keeps the stage's width. `fill` stretches the stage to the
 * row's height, as a column a `flex-1` stage can grow into.
 */
export default function StageRail({
  stage,
  rail,
  fill,
  className,
}: {
  stage: ReactNode;
  rail?: ReactNode;
  fill?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_var(--spacing-rail)]", className)}>
      <div className={cn("min-w-0", fill && "flex flex-col self-stretch")}>{stage}</div>
      {rail && <div className="flex min-w-0 flex-col gap-10">{rail}</div>}
    </div>
  );
}

export { StageRail };
