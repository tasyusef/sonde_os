import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { fadeVariants, SPRING } from "@/lib/motion";
import PixelIcon from "@/components/shared/PixelIcon";
import { copyToClipboard } from "@/lib/utils";

/** `size` follows the text beside it: `sm` in a line of data, `md` by a
 *  hero's large figure. */
export default function CopyButton({ text, size = "sm" }: { text: string; size?: "sm" | "md" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      // p-2.5 on mobile gives a ~29px tap target (closer to WCAG 44px
      // ideal without inflating the visual element); p-1.5 on sm+, where
      // a mouse is more likely and the icon needs to fit cleanly inside
      // dense Row layouts.
      className="p-2.5 text-muted hover:bg-primary hover:text-black sm:p-1.5"
      aria-label={copied ? "Copied" : "Copy to clipboard"}
    >
      <span className="inline-flex">
        {/* `mode="wait"` holds the next icon until the old one leaves,
             so exits use the quicker `snap`. */}
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.span
              key="check"
              className="inline-flex text-success"
              variants={fadeVariants}
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0, transition: SPRING.snap }}
              transition={SPRING.pop}
            >
              <PixelIcon name="check" size={size} />
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              className="inline-flex"
              variants={fadeVariants}
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0, transition: SPRING.snap }}
              transition={SPRING.pop}
            >
              <PixelIcon name="copy" size={size} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}
