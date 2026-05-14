import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  className?: string;
}

/**
 * Counts up from 0 to `value` over `duration` ms on mount.
 * Respects prefers-reduced-motion (shows final value immediately when active).
 */
export function AnimatedNumber({
  value,
  duration = 900,
  className,
}: AnimatedNumberProps) {
  const reducedMotion = useReducedMotion();
  const [displayed, setDisplayed] = useState(() => (reducedMotion ? value : 0));
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    const startValue = 0;
    const endValue = value;

    const animate = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(startValue + (endValue - startValue) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      startRef.current = null;
    };
  }, [value, duration, reducedMotion]);

  return <span className={className}>{displayed}</span>;
}
