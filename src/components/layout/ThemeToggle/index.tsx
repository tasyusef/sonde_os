import { AnimatePresence, motion } from "motion/react";
import Button from "@/components/shared/Button";
import PixelIcon from "@/components/shared/PixelIcon";
import { fadeVariants, SPRING } from "@/lib/motion";
import { useTheme } from "@/hooks/useTheme";

function ThemeIcon({ dark }: { dark: boolean }) {
  return (
    // `mode="wait"` holds the next icon until the old one leaves, so the
    // exit uses the quicker `snap`.
    <AnimatePresence mode="wait" initial={false}>
      {dark ? (
        <motion.span
          key="sun"
          className="inline-flex"
          variants={fadeVariants}
          initial="hidden"
          animate="visible"
          exit={{ opacity: 0, transition: SPRING.snap }}
          transition={SPRING.pop}
        >
          <PixelIcon name="sun" />
        </motion.span>
      ) : (
        <motion.span
          key="moon"
          className="inline-flex"
          variants={fadeVariants}
          initial="hidden"
          animate="visible"
          exit={{ opacity: 0, transition: SPRING.snap }}
          transition={SPRING.pop}
        >
          <PixelIcon name="moon" />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export default function ThemeToggle() {
  const { isDark: dark, toggleTheme: toggle } = useTheme();

  return (
    <Button
      onClick={toggle}
      variant="ghost"
      size="sm"
      iconOnly
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <ThemeIcon dark={dark} />
    </Button>
  );
}
