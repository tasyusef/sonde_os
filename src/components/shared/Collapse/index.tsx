import { type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { collapseVariants, INSTANT, SPRING } from "@/lib/motion";
import { useHydratedReducedMotion } from "@/lib/motion-client";

/**
 * A disclosure body (an FAQ answer, the raw JSON): it opens and closes
 * on `SPRING.layout`, so what sits below slides rather than jumps.
 * Unmounted while closed.
 *
 * `MotionProvider` doesn't cover height, so reduced motion opens it at
 * once here.
 */
export default function Collapse({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reduced = useHydratedReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          variants={collapseVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={reduced ? INSTANT : SPRING.layout}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
