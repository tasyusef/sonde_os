"use client";

import Tooltip from "@/components/shared/Tooltip";
import Button from "@/components/shared/Button";
import DemoCard from "../shared/DemoCard";

export default function TooltipDemo() {
  return (
    <DemoCard
      name="Tooltip"
      importPath="@/components/shared/Tooltip"
      description="Hover- or focus-triggered tooltip with a 300ms show delay. Positioned above the trigger element with a max-width of 260px. Uses the label prop for accessibility."
      preview={
        <div className="flex flex-wrap items-center justify-center gap-6 p-8">
          <Tooltip content="This is a tooltip that appears above the trigger element on hover or focus.">
            <Button variant="outline">Hover me</Button>
          </Tooltip>
          <Tooltip content="Tooltips support longer text that wraps to multiple lines when the content exceeds the max-width of 260px.">
            <Button variant="ghost" iconOnly aria-label="Info">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </Button>
          </Tooltip>
        </div>
      }
      code={`<Tooltip content="This is a tooltip message">
  <Button variant="outline">Hover me</Button>
</Tooltip>`}
    />
  );
}
