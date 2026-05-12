import type { ReactNode, CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { staggerContainer, staggerItem, staggerItemReduced } from "./variants";

interface StaggerListProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * A container that staggers reveal of direct children.
 * Each direct child should be wrapped with StaggerItem.
 */
export function StaggerList({ children, className, style }: StaggerListProps) {
  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={staggerContainer}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * An item inside StaggerList. Gets staggered fade-in + slide.
 */
export function StaggerItem({ children, className, style }: StaggerItemProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      variants={reducedMotion ? staggerItemReduced : staggerItem}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
