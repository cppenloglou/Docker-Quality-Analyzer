import type { Variants, Transition } from "motion/react";

export const DURATION_FAST = 0.18;
export const DURATION_NORMAL = 0.25;
export const EASE_OUT: Transition["ease"] = [0.25, 0.46, 0.45, 0.94];

/** Page entrance — fade + slight upward slide */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const pageTransition: Transition = {
  duration: DURATION_NORMAL,
  ease: EASE_OUT,
};

/** Reduced-motion version — opacity only */
export const pageVariantsReduced: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const pageTransitionReduced: Transition = {
  duration: DURATION_FAST,
};

/** Individual card reveal */
export const cardVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

export const cardTransition: Transition = {
  duration: DURATION_NORMAL,
  ease: EASE_OUT,
};

/** Parent container that staggers children */
export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.07, delayChildren: 0.04 },
  },
};

/** Stagger item — used as child of staggerContainer */
export const staggerItem: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION_NORMAL, ease: EASE_OUT } },
};

/** Horizontal stagger for pipeline arrows / list items */
export const staggerItemX: Variants = {
  initial: { opacity: 0, x: -10 },
  animate: { opacity: 1, x: 0, transition: { duration: DURATION_NORMAL, ease: EASE_OUT } },
};

/** Fade-only for reduced-motion stagger child */
export const staggerItemReduced: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION_FAST } },
};

/** Auth card entrance from below */
export const authCardVariants: Variants = {
  initial: { opacity: 0, y: 28, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
};

export const authCardTransition: Transition = {
  duration: 0.32,
  ease: EASE_OUT,
};

/** Score count-up overlay — just the number */
export const scoreVariants: Variants = {
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1 },
};

export const scoreTransition: Transition = {
  duration: 0.35,
  ease: [0.34, 1.56, 0.64, 1],
};

/** Grade badge pop-in */
export const badgePopVariants: Variants = {
  initial: { opacity: 0, scale: 0.7 },
  animate: { opacity: 1, scale: 1 },
};

export const badgePopTransition: Transition = {
  duration: 0.28,
  ease: [0.34, 1.56, 0.64, 1],
  delay: 0.1,
};

/** Ambient status pulse (used on running/connected indicators) */
export const pulseRing = {
  animate: {
    scale: [1, 1.25, 1],
    opacity: [0.6, 1, 0.6],
  },
  transition: {
    duration: 2.2,
    repeat: Infinity,
    ease: "easeInOut" as const,
  },
};

/** Drag-active upload border glow */
export const dragActiveVariants: Variants = {
  idle: { scale: 1, boxShadow: "0 0 0 0 transparent" },
  active: {
    scale: 1.015,
    boxShadow: "0 0 0 3px rgba(59,130,246,0.35), 0 0 24px rgba(59,130,246,0.15)",
  },
};

export const dragActiveTransition: Transition = {
  duration: 0.2,
  ease: EASE_OUT,
};
