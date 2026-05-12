import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

const MIN_LOADER_MS = 1500;
const FILL_INTERVAL_MS = 50;
const FILL_STEP = 100 / (MIN_LOADER_MS / FILL_INTERVAL_MS);

const DOCKER_PATH =
  "M 4 30 C 4 28 5 26 8 25 C 8 22 9 19 12 18 C 14 14 18 12 23 12 L 23 12 L 41 12 L 41 12 C 46 12 50 14 52 18 C 55 19 56 22 56 25 C 59 26 60 28 60 30 C 60 34 57 37 53 38 L 11 38 C 7 37 4 34 4 30 Z M 15 20 L 19 20 L 19 24 L 15 24 Z M 21 20 L 25 20 L 25 24 L 21 24 Z M 27 20 L 31 20 L 31 24 L 27 24 Z M 33 20 L 37 20 L 37 24 L 33 24 Z M 21 14 L 25 14 L 25 18 L 21 18 Z M 27 14 L 31 14 L 31 18 L 27 18 Z M 33 14 L 37 14 L 37 18 L 33 18 Z M 39 20 L 43 20 L 43 24 L 39 24 Z M 45 20 L 49 20 L 49 24 L 45 24 Z M 10 38 L 10 48 C 10 50 12 52 14 52 L 50 52 C 52 52 54 50 54 48 L 54 38 Z";

interface DockerLoaderProps {
  message?: string;
  fullScreen?: boolean;
}

export function DockerLoader({ message = "Loading...", fullScreen = true }: DockerLoaderProps) {
  const [fillPercent, setFillPercent] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const interval = setInterval(() => {
      setFillPercent((prev) => {
        const next = prev + FILL_STEP;
        if (next >= 100) return 100;
        return next;
      });
    }, FILL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const containerClass = fullScreen
    ? "min-h-screen bg-slate-950 flex flex-col items-center justify-center"
    : "flex-1 flex flex-col items-center justify-center min-h-[60vh]";

  return (
    <motion.div
      className={containerClass}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="relative w-20 h-20 mb-4"
        animate={reducedMotion ? {} : {
          y: [0, -4, 0],
        }}
        transition={{
          duration: 2.4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <svg
          viewBox="0 0 64 64"
          className="w-full h-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <clipPath id="docker-clip">
              <path d={DOCKER_PATH} />
            </clipPath>
          </defs>
          <path
            d={DOCKER_PATH}
            fill="none"
            stroke="#334155"
            strokeWidth="1.5"
          />
          <rect
            x="0"
            y={64 - (fillPercent / 100) * 64}
            width="64"
            height={(fillPercent / 100) * 64}
            fill="#3b82f6"
            clipPath="url(#docker-clip)"
            style={{ transition: "y 0.15s linear, height 0.15s linear" }}
          />
          <path
            d={DOCKER_PATH}
            fill="none"
            stroke="#64748b"
            strokeWidth="1"
          />
        </svg>
      </motion.div>
      <p className="text-slate-400 text-sm">{message}</p>
    </motion.div>
  );
}

/** Delays showing content until at least MIN_LOADER_MS after mount (avoids loader flash). */
// Hook co-located with loader UI; fast-refresh expects components-only in this module.
/* eslint-disable react-refresh/only-export-components */
export function useMinLoader(dataReady: boolean): boolean {
  const [minTimePassed, setMinTimePassed] = useState(false);
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    const elapsed = Date.now() - mountedAt;
    const delay = Math.max(0, MIN_LOADER_MS - elapsed);
    const timer = setTimeout(() => setMinTimePassed(true), delay);
    return () => clearTimeout(timer);
  }, [mountedAt]);

  return dataReady && minTimePassed;
}
/* eslint-enable react-refresh/only-export-components */
