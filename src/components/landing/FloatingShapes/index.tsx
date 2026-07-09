"use client";

import { motion, useReducedMotion } from "motion/react";

interface Shape {
  /** SVG element */
  el: React.ReactNode;
  /** Tailwind position classes */
  position: string;
  /** Float Y range [up, down] */
  floatY: [number, number];
  /** Float duration in seconds */
  floatDuration: number;
  /** Rotation duration (0 = no rotation) */
  rotateDuration: number;
  /** Opacity */
  opacity: number;
  /** Size in px */
  size: number;
}

const shapes: Shape[] = [
  {
    el: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
    position: "right-[12%] top-[18%]",
    floatY: [0, -14],
    floatDuration: 18,
    rotateDuration: 0,
    opacity: 0.06,
    size: 40,
  },
  {
    el: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
        <rect x="3" y="3" width="18" height="18" rx="4" />
      </svg>
    ),
    position: "left-[8%] bottom-[22%]",
    floatY: [0, 10],
    floatDuration: 22,
    rotateDuration: 35,
    opacity: 0.05,
    size: 32,
  },
  {
    el: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5" />
      </svg>
    ),
    position: "right-[6%] bottom-[30%]",
    floatY: [0, -10],
    floatDuration: 20,
    rotateDuration: 40,
    opacity: 0.04,
    size: 36,
  },
  {
    el: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    position: "left-[15%] top-[28%]",
    floatY: [0, 8],
    floatDuration: 16,
    rotateDuration: 0,
    opacity: 0.07,
    size: 12,
  },
  {
    el: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M12 2l10 18H2z" />
      </svg>
    ),
    position: "left-[28%] bottom-[12%]",
    floatY: [0, -8],
    floatDuration: 24,
    rotateDuration: 45,
    opacity: 0.04,
    size: 28,
  },
];

export function FloatingShapes() {
  const reduced = useReducedMotion();

  if (reduced) return null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {shapes.map((s, i) => (
        <motion.div
          key={i}
          className={`absolute text-brand ${s.position}`}
          style={{ width: s.size, height: s.size, opacity: s.opacity }}
          animate={{
            y: [s.floatY[0], s.floatY[1], s.floatY[0]],
            ...(s.rotateDuration > 0 ? { rotate: [0, 360] } : {}),
          }}
          transition={{
            y: {
              duration: s.floatDuration,
              repeat: Infinity,
              ease: "easeInOut",
            },
            ...(s.rotateDuration > 0
              ? {
                  rotate: {
                    duration: s.rotateDuration,
                    repeat: Infinity,
                    ease: "linear",
                  },
                }
              : {}),
          }}
        >
          {s.el}
        </motion.div>
      ))}
    </div>
  );
}

export default FloatingShapes;
