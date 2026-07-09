"use client";

import { useRef, useEffect } from "react";
import { motion, useReducedMotion, useAnimationControls } from "motion/react";

/**
 * Scroll-triggered entrance animation wrapper.
 *
 * - SSR: renders children normally (no opacity-0 flash)
 * - Mount + above fold: stays visible, no animation
 * - Mount + below fold: hides imperatively, then animates in on scroll
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** Delay in milliseconds before the entrance animation starts (converted to seconds internally) */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const controls = useAnimationControls();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;

    // Above fold on mount → skip animation, stay visible
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) return;

    // Below fold → hide immediately, observe for scroll
    controls.set({ opacity: 0, y: 8 });

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          controls.start({
            opacity: 1,
            y: 0,
            transition: { duration: 0.4, delay: delay / 1000, ease: "easeOut" },
          });
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [controls, delay, reduced]);

  return (
    <motion.div ref={ref} className={className} animate={controls}>
      {children}
    </motion.div>
  );
}

export default Reveal;
