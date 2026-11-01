import { useEffect, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import Button from "@/components/shared/Button";
import PixelIcon from "@/components/shared/PixelIcon";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useVisibleBox } from "@/hooks/useVisibleBox";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import MobileBar from "./MobileBar";

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  /** Names the dialog. */
  label: string;
  closeLabel: string;
  /** `top` (the menu) drops from under the header's bar, which keeps
   *  its place with the close where the menu button sits. `bottom`
   *  (the search) rises from the bottom edge, with the close where
   *  the search button sits and its content set clear of it. */
  from?: "top" | "bottom";
  /** Fills the sheet, on the page ground. */
  children: ReactNode;
}

/**
 * A full-screen sheet for the mobile menu and search. The close is
 * drawn at once in place of the button that opened it, so only the
 * sheet moves. No backdrop; the sheet covers the page. Escape closes
 * it, and the page behind doesn't scroll.
 *
 * A bottom sheet keeps to the part of the screen you can see, so its
 * foot rides above the keyboard while you type; there the foot drops
 * the home indicator's inset, which the keyboard covers.
 */
export default function MobileSheet({ open, onClose, label, closeLabel, from = "top", children }: MobileSheetProps) {
  const sheetRef = useFocusTrap<HTMLDivElement>(open);
  const bottom = from === "bottom";
  const box = useVisibleBox(bottom);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const close = (
    <Button
      onClick={onClose}
      aria-label={closeLabel}
      variant="ghost"
      size="md"
      iconOnly
      // The bottom close is opaque, so it covers the search button
      // under it while the sheet goes.
      className={
        bottom
          ? cn("absolute right-4 h-12 w-12 bg-black", box?.keyboard ? "bottom-5" : "bottom-[var(--fab-search-bottom)]")
          : "h-9 w-9"
      }
    >
      <PixelIcon name="close" />
    </Button>
  );
  const visible: CSSProperties | undefined = box ? { top: box.top, height: box.height, bottom: "auto" } : undefined;

  return (
    <AnimatePresence>
      {open && (
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="fixed inset-0 z-50 flex flex-col md:hidden"
          style={visible}
        >
          {!bottom && <MobileBar>{close}</MobileBar>}
          <div className="min-h-0 flex-1 overflow-hidden">
            <motion.div
              initial={{ y: bottom ? "100%" : "-100%" }}
              animate={{ y: 0 }}
              exit={{ y: bottom ? "100%" : "-100%" }}
              transition={SPRING.sheet}
              className={cn(
                "flex h-full flex-col bg-black",
                // Room for the close: 16px edge, 48px block, 8px gap.
                bottom && "pl-4 pr-18",
                bottom && (box?.keyboard ? "pb-5" : "pb-[var(--fab-search-bottom)]"),
              )}
            >
              {children}
            </motion.div>
          </div>
          {bottom && close}
        </div>
      )}
    </AnimatePresence>
  );
}
