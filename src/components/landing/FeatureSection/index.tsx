"use client";

import { useRef, type ReactNode } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
} from "motion/react";
import { cn } from "@/lib/utils";
import { TiltCard } from "@/components/landing/TiltCard";

interface FeatureSectionProps {
  index: number;
  title: string;
  description: string;
  icon: ReactNode;
  preview: ReactNode;
}

export function FeatureSection({
  index,
  title,
  description,
  icon,
  preview,
}: FeatureSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  // Text block animations
  const textY = useTransform(scrollYProgress, [0, 0.35], [60, 0]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.35], [0, 1]);

  // Preview card animations — 3D tilt from opposite side
  const previewY = useTransform(scrollYProgress, [0.05, 0.4], [80, 0]);
  const previewOpacity = useTransform(scrollYProgress, [0.05, 0.4], [0, 1]);
  const previewRotateY = useTransform(
    scrollYProgress,
    [0.05, 0.4],
    [index % 2 === 0 ? 8 : -8, 0]
  );
  const previewRotateX = useTransform(scrollYProgress, [0.05, 0.4], [12, 0]);

  const reversed = index % 2 !== 0;

  // Split title into words, last word gets accent
  const words = title.split(" ");
  const mainWords = words.slice(0, -1).join(" ");
  const accentWord = words[words.length - 1];

  return (
    <div ref={ref} className="relative px-6 py-20 sm:py-28 lg:py-36">
      <div
        className={cn(
          "mx-auto flex max-w-6xl flex-col items-center gap-12 lg:flex-row lg:gap-20",
          reversed && "lg:flex-row-reverse"
        )}
      >
        {/* Text side */}
        <motion.div
          className="flex flex-1 flex-col items-center text-center lg:items-start lg:text-left"
          style={
            reduced
              ? {}
              : {
                  y: textY,
                  opacity: textOpacity,
                }
          }
        >
          {/* Section number + icon */}
          <div className="mb-6 flex items-center gap-3">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
              {icon}
            </span>
            <span aria-hidden="true" className="font-display text-tag font-medium uppercase tracking-header text-muted">
              0{index + 1}
            </span>
          </div>

          <h2 className="mb-4 max-w-lg font-display text-title font-bold leading-[1.1] text-primary sm:text-display">
            {mainWords}{" "}
            <span className="text-brand">{accentWord}</span>
          </h2>

          <p className="max-w-md font-body text-lg leading-relaxed text-secondary">
            {description}
          </p>
        </motion.div>

        {/* Preview side */}
        <motion.div
          className="flex-1"
          style={
            reduced
              ? {}
              : {
                  y: previewY,
                  opacity: previewOpacity,
                  rotateY: previewRotateY,
                  rotateX: previewRotateX,
                  transformPerspective: 1000,
                }
          }
        >
          <TiltCard>{preview}</TiltCard>
        </motion.div>
      </div>
    </div>
  );
}

export default FeatureSection;
