"use client";

import { useRef, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  useMotionTemplate,
} from "motion/react";

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  /** Max tilt angle in degrees. Default: 8 */
  maxTilt?: number;
  /** Whether to show the glare overlay. Default: true */
  glare?: boolean;
  /** Max opacity of glare. Default: 0.10 */
  glareOpacity?: number;
}

const springConfig = { stiffness: 150, damping: 20 };

export function TiltCard({
  children,
  className,
  maxTilt = 8,
  glare = true,
  glareOpacity = 0.04,
}: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  // Raw cursor position normalized to [0, 100] for gradient percentage
  const pctX = useMotionValue(50);
  const pctY = useMotionValue(50);

  // Normalized [-1, 1] for rotation
  const normX = useMotionValue(0);
  const normY = useMotionValue(0);

  // Sprung rotation values
  const rotateY = useSpring(
    useTransform(normX, [-1, 1], [-maxTilt, maxTilt]),
    springConfig
  );
  const rotateX = useSpring(
    useTransform(normY, [-1, 1], [maxTilt, -maxTilt]),
    springConfig
  );

  // Glare as a radial gradient positioned at cursor %
  const springPctX = useSpring(pctX, springConfig);
  const springPctY = useSpring(pctY, springConfig);
  const glareVisible = useMotionValue(0);
  const glareSpring = useSpring(glareVisible, { stiffness: 200, damping: 30 });

  const glareBackground = useMotionTemplate`radial-gradient(circle at ${springPctX}% ${springPctY}%, rgba(255,255,255,${glareOpacity}) 0%, transparent 60%)`;

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    pctX.set(x * 100);
    pctY.set(y * 100);
    normX.set(x * 2 - 1);
    normY.set(y * 2 - 1);
  }

  function handleMouseEnter() {
    glareVisible.set(1);
  }

  function handleMouseLeave() {
    normX.set(0);
    normY.set(0);
    pctX.set(50);
    pctY.set(50);
    glareVisible.set(0);
  }

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={className} style={{ perspective: 800 }}>
      <motion.div
        ref={ref}
        className="relative"
        style={{ rotateX, rotateY }}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
        {glare && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
            style={{ opacity: glareSpring, background: glareBackground }}
          />
        )}
      </motion.div>
    </div>
  );
}

export default TiltCard;
