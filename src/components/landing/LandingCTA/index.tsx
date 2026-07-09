"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { SondeMark } from "@/components/shared/SondeLogo";
import { CTAButton } from "@/components/landing/CTAButton";

export function LandingCTA() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  // Trimmed from 60px to 24px — the bigger offset stacked with the
  // FeatureShowcase / LandingCTA padding above to give the CTA section
  // a ~250px dead zone before the icon appeared mid-scroll.
  const y = useTransform(scrollYProgress, [0, 0.5], [24, 0]);
  const opacity = useTransform(scrollYProgress, [0, 0.4], [0, 1]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [0.9, 1]);

  return (
    <section
      ref={ref}
      // Section frame: tight vertical padding (content-sized, no
      // min-h) + the brand-tinted gradient backdrop. Top padding is
      // small because `FeatureShowcase` immediately precedes this and
      // its own bottom padding already provides the section break.
      // Bottom padding stays generous to separate from the global
      // Footer.
      className="relative overflow-hidden px-6 pt-6 pb-16 sm:pt-8 sm:pb-20"
    >
      {/* Gradient backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-brand/5 via-transparent to-transparent" />

      <motion.div
        // Block-centred CTA, max-w-3xl so it doesn't stretch to
        // viewport width. Stack on top: icon + headline. Bottom:
        // subtitle and button side-by-side, centred as a unit.
        // Mobile collapses the side-by-side to stacked.
        className="relative z-10 mx-auto flex max-w-3xl flex-col items-center text-center"
        style={reduced ? {} : { y, opacity, scale }}
      >
        <SondeMark aria-hidden="true" size={48} className="mb-6 text-brand" />

        <h2 className="mb-6 font-display text-display font-bold leading-display tracking-display text-primary sm:text-display-lg">
          See the ledger{" "}
          <span className="text-brand">move.</span>
        </h2>

        {/* Subtitle + button row, centred as a unit. Subtitle is
             left-aligned at sm+ since it wraps to two lines next to
             the button (centred multi-line text against a button on
             the right looks unbalanced); reverts to text-center on
             mobile when the layout stacks. */}
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-6">
          <p className="max-w-md font-body text-lg text-secondary sm:text-left">
            Transaction volume, fee burn, payment corridors, anomaly
            detection — every layer of XRPL activity in real time.
          </p>
          <div className="shrink-0">
            <CTAButton
              href="/network"
              label="See the network"
              reduced={reduced}
            />
          </div>
        </div>
      </motion.div>
    </section>
  );
}

export default LandingCTA;
