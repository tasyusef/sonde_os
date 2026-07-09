"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { buttonClasses } from "@/components/shared/Button";

interface CTAButtonProps {
  /** Where the button should navigate. Used to live hard-coded as `/`
   *  when there was only one possible destination; required now that
   *  the landing has multiple CTA targets. */
  href: string;
  label: string;
  reduced?: boolean | null;
}

export function CTAButton({ href, label, reduced }: CTAButtonProps) {
  return (
    <motion.div
      whileHover={reduced ? {} : { scale: 1.04 }}
      whileTap={reduced ? {} : { scale: 0.97 }}
    >
      <Link
        href={href}
        className={buttonClasses({ variant: "primary", size: "lg" })}
      >
        {label}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </Link>
    </motion.div>
  );
}

export default CTAButton;
