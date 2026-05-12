import type { ReactNode, CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "../ui/utils";

interface MotionCardProps {
  children: ReactNode;
  /** Delay in seconds for staggered reveals */
  delay?: number;
  /** Disable hover lift/glow effect (useful for interactive clickable cards handled elsewhere) */
  noHover?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * A thin wrapper that reveals a card with a fade + upward slide and adds a
 * subtle hover lift. Respects prefers-reduced-motion.
 */
export function MotionCard({
  children,
  delay = 0,
  noHover = false,
  className,
  style,
}: MotionCardProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.25, 0.46, 0.45, 0.94], delay }}
      whileHover={
        !noHover && !reducedMotion
          ? { y: -3, boxShadow: "0 8px 28px rgba(0,0,0,0.4), 0 0 0 1px rgba(59,130,246,0.12)" }
          : undefined
      }
      className={cn("will-change-transform", className)}
      style={style}
    >
      {children}
    </motion.div>
  );
}
