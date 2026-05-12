import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  pageVariants,
  pageTransition,
  pageVariantsReduced,
  pageTransitionReduced,
} from "./variants";

interface MotionPageProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a page's main content block with a subtle fade + upward slide entrance.
 * Falls back to opacity-only when the user prefers reduced motion.
 */
export function MotionPage({ children, className }: MotionPageProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={reducedMotion ? pageVariantsReduced : pageVariants}
      transition={reducedMotion ? pageTransitionReduced : pageTransition}
      className={className}
    >
      {children}
    </motion.div>
  );
}
