import { useState } from "react";
import SectionHeader from "./SectionHeader";
import ButtonDemo from "./demos/ButtonDemo";
import DropdownMenuDemo from "./demos/DropdownMenuDemo";
import ToggleDemo from "./demos/ToggleDemo";
import TabsDemo from "./demos/TabsDemo";
import TooltipDemo from "./demos/TooltipDemo";
import PaginationDemo from "./demos/PaginationDemo";
import SkeletonDemo from "./demos/SkeletonDemo";
import TypeTagDemo from "./demos/TypeTagDemo";
import StatusBadgeDemo from "./demos/StatusBadgeDemo";
import AddressLinkDemo from "./demos/AddressLinkDemo";
import HashLinkDemo from "./demos/HashLinkDemo";
import AmountDisplayDemo from "./demos/AmountDisplayDemo";
import CopyButtonDemo from "./demos/CopyButtonDemo";
import PageHeroDemo from "./demos/PageHeroDemo";
import LogoDemo from "./demos/LogoDemo";
import RevealDemo from "./demos/RevealDemo";
import { cn } from "@/lib/utils";

/**
 * Demo registry. Grouped roughly by purpose:
 * - Primitives (Button, DropdownMenu, Toggle, Tabs, Tooltip, Pagination, Skeleton)
 * - Data display (TypeTag, StatusBadge, AddressLink, HashLink, AmountDisplay, CopyButton)
 * - Layout (PageHero, Logo, Reveal)
 */
const demos = [
  // Primitives
  { id: "button", label: "Button", component: ButtonDemo },
  { id: "dropdown", label: "DropdownMenu", component: DropdownMenuDemo },
  { id: "toggle", label: "Toggle", component: ToggleDemo },
  { id: "tabs", label: "Tabs", component: TabsDemo },
  { id: "tooltip", label: "Tooltip", component: TooltipDemo },
  { id: "pagination", label: "Pagination", component: PaginationDemo },
  { id: "skeleton", label: "Skeleton", component: SkeletonDemo },

  // Data display
  { id: "typetag", label: "TypeTag", component: TypeTagDemo },
  { id: "statusbadge", label: "StatusBadge", component: StatusBadgeDemo },
  { id: "addresslink", label: "AddressLink", component: AddressLinkDemo },
  { id: "hashlink", label: "HashLink", component: HashLinkDemo },
  { id: "amount", label: "AmountDisplay", component: AmountDisplayDemo },
  { id: "copybutton", label: "CopyButton", component: CopyButtonDemo },

  // Layout
  { id: "pagehero", label: "PageHero", component: PageHeroDemo },
  { id: "logo", label: "Logo", component: LogoDemo },
  { id: "reveal", label: "Reveal", component: RevealDemo },
];

export default function ComponentSection() {
  const [activeDemo, setActiveDemo] = useState("button");
  const ActiveComponent = demos.find((d) => d.id === activeDemo)?.component ?? ButtonDemo;

  return (
    <section id="components" className="scroll-mt-20">
      <SectionHeader
        title="Components"
        subtitle="Live interactive demos of the shared UI library. Every component on the site should come from here."
      />

      {/* Component selector */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {demos.map((d) => (
          <button
            key={d.id}
            onClick={() => setActiveDemo(d.id)}
            className={cn(
              "px-3 py-1.5 font-display text-caps uppercase",
              activeDemo === d.id
                ? "bg-accent text-on-accent"
                : "text-muted hover:bg-primary hover:text-black",
            )}
          >
            {d.label}
          </button>
        ))}
      </div>

      <ActiveComponent />
    </section>
  );
}
