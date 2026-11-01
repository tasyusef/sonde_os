import { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";
import MobileBar from "@/components/layout/MobileSheet/MobileBar";
import MobileSheet from "@/components/layout/MobileSheet";
import { NodeName } from "@/components/layout/StatusStrip/NodeName";
import Button from "@/components/shared/Button";
import PixelIcon from "@/components/shared/PixelIcon";
import { SPRING } from "@/lib/motion";
import { SidebarBody } from "./SidebarBody";
import { useHiddenOnScroll } from "./useHiddenOnScroll";

/** The mobile header (logo, latest ledger, menu), flat on the page
 *  ground, out of the way while you scroll down. The menu opens the
 *  sidebar's own mat as a sheet, with the node this browser reads from
 *  at its foot. */
export function MobileHeader({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const hidden = useHiddenOnScroll(headerRef);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <motion.header
        ref={headerRef}
        initial={false}
        animate={{ y: hidden ? "-100%" : 0 }}
        transition={SPRING.smooth}
        className="fixed inset-x-0 top-0 z-40 md:hidden"
      >
        <MobileBar>
          <Button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            variant="ghost"
            size="md"
            iconOnly
            className="h-9 w-9"
          >
            <PixelIcon name="menu" />
          </Button>
        </MobileBar>
      </motion.header>

      <MobileSheet open={open} onClose={close} label="Menu" closeLabel="Close menu">
        <SidebarBody
          pathname={pathname}
          foot={<NodeName className="flex h-9 items-center pl-2 font-mono text-ui text-muted" />}
        />
      </MobileSheet>
    </>
  );
}
