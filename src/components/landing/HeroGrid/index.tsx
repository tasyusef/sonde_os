"use client";

import { motion, useReducedMotion } from "motion/react";

export function HeroGrid() {
  const reduced = useReducedMotion();

  // Reduced motion — render static background
  if (reduced) {
    return (
      <>
        <div className="landing-gradient pointer-events-none absolute inset-0" />
        <div className="landing-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_30%,black_30%,transparent_100%)]" />
      </>
    );
  }

  return (
    <>
      {/* Static gradient layer */}
      <div className="landing-gradient pointer-events-none absolute inset-0" />

      {/* Animated grid — loops seamlessly every 20s (60px matches background-size) */}
      <motion.div
        className="landing-grid pointer-events-none absolute -inset-16 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_30%,black_30%,transparent_100%)]"
        animate={{ backgroundPosition: ["0px 0px", "60px 60px"] }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
      />
    </>
  );
}

export default HeroGrid;
