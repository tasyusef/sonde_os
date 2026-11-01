import Tooltip from "@/components/shared/Tooltip";
import Button from "@/components/shared/Button";
import PixelIcon from "@/components/shared/PixelIcon";
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
              <PixelIcon name="info" />
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
