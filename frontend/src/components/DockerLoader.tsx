import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

const MIN_LOADER_MS = 1800;
const FILL_INTERVAL_MS = 50;
const FILL_STEP = 100 / (MIN_LOADER_MS / FILL_INTERVAL_MS);
/** Title fully flooded by this %; remaining % holds before the cycle ends. */
const FILL_TITLE_COMPLETE_AT = 88;
const VIEW_Y_MIN = -36;
const TITLE_FILL_TOP = VIEW_Y_MIN;

/** Loader fill palette (slightly darker than blue-500 / pure white). */
const LOADER_BLUE = "#1d4ed8";
const LOADER_LIGHT = "#cbd5e1";

const APP_TITLE = "Docker Analyzer";

const VIEW_W = 300;
const VIEW_H = 118;
const VIEW_BOX_H = VIEW_H - VIEW_Y_MIN;
const ICON_DRAW_SIZE = 64;
const ICON_SCALE = 1.25;
const ICON_VISUAL_SIZE = ICON_DRAW_SIZE * ICON_SCALE;
const ICON_X = (VIEW_W - ICON_VISUAL_SIZE) / 2;
const ICON_Y = 30;
const TITLE_FONT_SIZE = 18;

/** Arc bows upward; strong curve with ends near the whale. */
const TITLE_ARC_PATH = `M 58 34 Q ${VIEW_W / 2} -12 ${VIEW_W - 58} 34`;

const TITLE_TEXT_STYLE = {
  fontSize: TITLE_FONT_SIZE,
  fontWeight: 600,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};

function LoaderTitleText({
  arcId,
  fill,
  stroke,
  strokeWidth,
}: {
  arcId: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  return (
    <text {...TITLE_TEXT_STYLE} fill={fill} stroke={stroke} strokeWidth={strokeWidth}>
      <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">
        {APP_TITLE}
      </textPath>
    </text>
  );
}

function globalWaterYFromFillPercent(percent: number): number {
  const fillRange = VIEW_H - TITLE_FILL_TOP;
  const t = Math.min(percent, FILL_TITLE_COMPLETE_AT) / FILL_TITLE_COMPLETE_AT;
  return VIEW_H - t * fillRange;
}

const DOCKER_PATH =
  "M 4 30 C 4 28 5 26 8 25 C 8 22 9 19 12 18 C 14 14 18 12 23 12 L 23 12 L 41 12 L 41 12 C 46 12 50 14 52 18 C 55 19 56 22 56 25 C 59 26 60 28 60 30 C 60 34 57 37 53 38 L 11 38 C 7 37 4 34 4 30 Z M 15 22 L 19 22 L 19 26 L 15 26 Z M 21 22 L 25 22 L 25 26 L 21 26 Z M 27 22 L 31 22 L 31 26 L 27 26 Z M 33 22 L 37 22 L 37 26 L 33 26 Z M 21 16 L 25 16 L 25 20 L 21 20 Z M 27 16 L 31 16 L 31 20 L 27 20 Z M 33 16 L 37 16 L 37 20 L 33 20 Z M 39 22 L 43 22 L 43 26 L 39 26 Z M 45 22 L 49 22 L 49 26 L 45 26 Z M 10 38 L 10 48 C 10 50 12 52 14 52 L 50 52 C 52 52 54 50 54 48 L 54 38 Z";

/** Container cubes (bottom Y = when the rising fill turns them white). */
const DOCKER_CUBES: { d: string; bottom: number }[] = [
  { d: "M 15 22 L 19 22 L 19 26 L 15 26 Z", bottom: 26 },
  { d: "M 21 22 L 25 22 L 25 26 L 21 26 Z", bottom: 26 },
  { d: "M 27 22 L 31 22 L 31 26 L 27 26 Z", bottom: 26 },
  { d: "M 33 22 L 37 22 L 37 26 L 33 26 Z", bottom: 26 },
  { d: "M 39 22 L 43 22 L 43 26 L 39 26 Z", bottom: 26 },
  { d: "M 45 22 L 49 22 L 49 26 L 45 26 Z", bottom: 26 },
  { d: "M 21 16 L 25 16 L 25 20 L 21 20 Z", bottom: 20 },
  { d: "M 27 16 L 31 16 L 31 20 L 27 20 Z", bottom: 20 },
  { d: "M 33 16 L 37 16 L 37 20 L 33 20 Z", bottom: 20 },
];

interface DockerLoaderProps {
  message?: string;
  fullScreen?: boolean;
}

export function DockerLoader({ message = "Loading...", fullScreen = true }: DockerLoaderProps) {
  const [fillPercent, setFillPercent] = useState(0);
  const reducedMotion = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const shapeClip = `docker-shape-${uid}`;
  const iconFillBandClip = `docker-icon-fill-band-${uid}`;
  const iconUnfillBandClip = `docker-icon-unfill-band-${uid}`;
  const globalFillBandClip = `docker-global-fill-band-${uid}`;
  const globalUnfillBandClip = `docker-global-unfill-band-${uid}`;
  const titleTextClip = `docker-title-text-${uid}`;
  const titleArcId = `docker-title-arc-${uid}`;

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

  const globalWaterY = globalWaterYFromFillPercent(fillPercent);
  const iconWaterY = Math.min(
    ICON_DRAW_SIZE,
    Math.max(0, (globalWaterY - ICON_Y) / ICON_SCALE),
  );

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
        className="w-80 mb-4"
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
          viewBox={`0 ${VIEW_Y_MIN} ${VIEW_W} ${VIEW_BOX_H}`}
          className="w-full h-auto overflow-visible"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={APP_TITLE}
        >
          <defs>
            <path id={titleArcId} d={TITLE_ARC_PATH} fill="none" />
            <clipPath id={titleTextClip}>
              <LoaderTitleText arcId={titleArcId} fill="#000" />
            </clipPath>
            <clipPath id={globalFillBandClip}>
              <rect x="0" y={globalWaterY} width={VIEW_W} height={VIEW_H - globalWaterY} />
            </clipPath>
            <clipPath id={globalUnfillBandClip}>
              <rect
                x="0"
                y={VIEW_Y_MIN}
                width={VIEW_W}
                height={Math.max(0, globalWaterY - VIEW_Y_MIN)}
              />
            </clipPath>
            <clipPath id={shapeClip}>
              <path d={DOCKER_PATH} />
            </clipPath>
            <clipPath id={iconFillBandClip}>
              <rect
                x="0"
                y={iconWaterY}
                width={ICON_DRAW_SIZE}
                height={ICON_DRAW_SIZE - iconWaterY}
              />
            </clipPath>
            <clipPath id={iconUnfillBandClip}>
              <rect x="0" y="0" width={ICON_DRAW_SIZE} height={iconWaterY} />
            </clipPath>
          </defs>

          <g>
            <g clipPath={`url(#${globalUnfillBandClip})`}>
              <LoaderTitleText
                arcId={titleArcId}
                fill="none"
                stroke="#64748b"
                strokeWidth={0.75}
              />
            </g>
            <g clipPath={`url(#${globalFillBandClip})`}>
              <rect
                x="0"
                y={globalWaterY}
                width={VIEW_W}
                height={VIEW_H - globalWaterY}
                fill={LOADER_BLUE}
                clipPath={`url(#${titleTextClip})`}
                style={{ transition: "y 0.15s linear, height 0.15s linear" }}
              />
              <LoaderTitleText arcId={titleArcId} fill={LOADER_LIGHT} />
            </g>
          </g>

          <g transform={`translate(${ICON_X}, ${ICON_Y}) scale(${ICON_SCALE})`}>
            <g clipPath={`url(#${shapeClip})`}>
              <g clipPath={`url(#${iconUnfillBandClip})`}>
                <path
                  d={DOCKER_PATH}
                  fill="none"
                  stroke="#334155"
                  strokeWidth="1.5"
                />
                <path
                  d={DOCKER_PATH}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1"
                />
              </g>
            </g>
            <rect
              x="0"
              y={iconWaterY}
              width={ICON_DRAW_SIZE}
              height={ICON_DRAW_SIZE - iconWaterY}
              fill={LOADER_BLUE}
              clipPath={`url(#${shapeClip})`}
              style={{ transition: "y 0.15s linear, height 0.15s linear" }}
            />
            {DOCKER_CUBES.map((cube, i) =>
              iconWaterY <= cube.bottom ? (
                <path
                  key={i}
                  d={cube.d}
                  fill={LOADER_LIGHT}
                  stroke={LOADER_LIGHT}
                  strokeWidth="0.75"
                  clipPath={`url(#${shapeClip})`}
                  style={{ transition: "fill 0.12s ease-out, stroke 0.12s ease-out" }}
                />
              ) : null,
            )}
            <g clipPath={`url(#${shapeClip})`}>
              <g clipPath={`url(#${iconFillBandClip})`}>
                <path
                  d={DOCKER_PATH}
                  fill="none"
                  stroke={LOADER_LIGHT}
                  strokeWidth="1.5"
                  style={{ transition: "stroke 0.12s ease-out" }}
                />
                <path
                  d={DOCKER_PATH}
                  fill="none"
                  stroke={LOADER_LIGHT}
                  strokeWidth="1"
                  style={{ transition: "stroke 0.12s ease-out" }}
                />
              </g>
            </g>
          </g>
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
