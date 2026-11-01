import { AnimatePresence, motion } from "motion/react";
import { useListboxKeys } from "@/components/shared/ResponsiveSelect/useListboxKeys";
import { slideDownVariants, SPRING } from "@/lib/motion";
import PixelIcon from "@/components/shared/PixelIcon";

/** "More" + chevron. Also rendered in Tabs' hidden measurement row, so
 *  the trigger's width is known before it first appears. */
export function MoreLabel({ open = false }: { open?: boolean }) {
  return (
    <>
      More
      <PixelIcon name={open ? "chevron-up" : "chevron-down"} size="sm" />
    </>
  );
}

/**
 * Tabs that don't fit the strip, behind a listbox button. It sits
 * beside the tablist, not in it: a tablist may only own tabs. The active
 * tab is never in here (Tabs promotes it into the strip), so picking an
 * option promotes that tab and focus follows it there via `onSelect`
 * rather than returning to this trigger.
 */
export default function MoreMenu({
  tabs,
  onSelect,
  triggerClassName,
}: {
  tabs: { id: string; label: string }[];
  onSelect: (id: string) => void;
  triggerClassName: string;
}) {
  const { open, close, containerRef, triggerProps, getOptionProps } =
    useListboxKeys({ count: tabs.length, selectedIndex: -1 });

  return (
    <div ref={containerRef} className="relative">
      <button {...triggerProps} type="button" className={triggerClassName}>
        <MoreLabel open={open} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label="More tabs"
            variants={slideDownVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={SPRING.pop}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-50 mt-1 min-w-[160px] bg-surface py-1 shadow-card"
          >
            {tabs.map((tab, i) => (
              // Inset focus outline so it stays inside the panel.
              <button
                key={tab.id}
                {...getOptionProps(i)}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  close({ returnFocus: false });
                  onSelect(tab.id);
                }}
                className="block w-full whitespace-nowrap px-4 py-2 text-left font-display text-caps uppercase text-muted hover:bg-primary hover:text-black focus-visible:bg-primary focus-visible:text-black -outline-offset-2"
              >
                {tab.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
