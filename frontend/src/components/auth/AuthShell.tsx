import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  Boxes,
  Container,
  FileCode2,
  Route,
  Server,
  Shield,
  ShieldAlert,
  Workflow,
  Zap,
} from "lucide-react";

interface AuthShellProps {
  mode: "login" | "register";
  children: ReactNode;
}

function FloatingTile({
  className,
  icon,
}: {
  className: string;
  icon: ReactNode;
}) {
  return (
    <div className={className}>
      {icon}
    </div>
  );
}

function NodeCard({
  title,
  subtitle,
  icon,
  colorClass,
  className,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  colorClass: string;
  className: string;
}) {
  return (
    <div className={className}>
      <div className={`auth-flow-node-frame rounded-xl border bg-slate-900/94 px-4 py-3.5 ${colorClass}`}>
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          {icon}
          {title}
        </div>
        <div className="mt-1.5 text-xs text-slate-400">{subtitle}</div>
      </div>
    </div>
  );
}

function MiniChip({
  label,
  icon,
  className,
}: {
  label: string;
  icon: ReactNode;
  className: string;
}) {
  return (
    <div className={`${className} auth-flow-chip`}>
      <span className="text-slate-300">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function ContainerFlowPanel() {
  const nodeClass =
    "absolute left-1/2 z-30 w-[34%] -translate-x-1/2 -translate-y-1/2";
  const chipClass =
    "absolute z-30 inline-flex h-10 w-[24%] -translate-y-1/2 items-center justify-center gap-1.5 rounded-xl border bg-slate-900/92 px-3 text-xs text-slate-300 shadow-[0_8px_20px_rgba(2,6,23,0.28)]";

  return (
    <div className="relative h-full min-h-[390px] flex-1 overflow-hidden rounded-2xl border border-slate-500/80 bg-slate-950/88 p-4">

      {/*
        The diagram uses one shared percentage coordinate system:
        - left chips:  left 8%, width 24%  => right edge 32%
        - node cards:  left 50%, width 34% => edges 33% and 67%
        - right chips: right 8%, width 24% => left edge 68%
        SVG paths intentionally overlap those edges by ~1 so the lines sit
        underneath the borders and look physically connected on every width.
      */}
      <svg
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="auth-flow-side-link-1-left" x1="31.5" y1="9" x2="33.5" y2="14" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(34 211 238)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="auth-flow-side-link-1-right" x1="68.5" y1="20" x2="66.5" y2="14" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(34 211 238)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="auth-flow-side-link-2-left" x1="31.5" y1="43" x2="33.5" y2="39" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="auth-flow-side-link-2-right" x1="68.5" y1="34" x2="66.5" y2="39" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="auth-flow-side-link-3-left" x1="31.5" y1="60" x2="33.5" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(14 165 233)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="auth-flow-side-link-3-right" x1="68.5" y1="71" x2="66.5" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(14 165 233)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="auth-flow-side-link-4-left" x1="31.5" y1="93" x2="33.5" y2="89" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(251 191 36)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(245 158 11)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="auth-flow-side-link-4-right" x1="68.5" y1="83" x2="66.5" y2="89" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(251 191 36)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(245 158 11)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="auth-flow-main-link-1" x1="50" y1="19.5" x2="50" y2="32.5" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(34 211 238)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="auth-flow-main-link-2" x1="50" y1="44.5" x2="50" y2="57.5" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(14 165 233)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="auth-flow-main-link-3" x1="50" y1="69.5" x2="50" y2="82.5" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(14 165 233)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(245 158 11)" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <g
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        >
          <path className="auth-flow-link auth-flow-link-delay-0" d="M 31.5 9 L 33.5 14" stroke="url(#auth-flow-side-link-1-left)" />
          <path className="auth-flow-link auth-flow-link-delay-1" d="M 68.5 20 L 66.5 14" stroke="url(#auth-flow-side-link-1-right)" />

          <path className="auth-flow-link auth-flow-link-delay-2" d="M 31.5 43 L 33.5 39" stroke="url(#auth-flow-side-link-2-left)" />
          <path className="auth-flow-link auth-flow-link-delay-3" d="M 68.5 34 L 66.5 39" stroke="url(#auth-flow-side-link-2-right)" />

          <path className="auth-flow-link auth-flow-link-delay-0" d="M 31.5 60 L 33.5 64" stroke="url(#auth-flow-side-link-3-left)" />
          <path className="auth-flow-link auth-flow-link-delay-1" d="M 68.5 71 L 66.5 64" stroke="url(#auth-flow-side-link-3-right)" />

          <path className="auth-flow-link auth-flow-link-delay-2" d="M 31.5 93 L 33.5 89" stroke="url(#auth-flow-side-link-4-left)" />
          <path className="auth-flow-link auth-flow-link-delay-3" d="M 68.5 83 L 66.5 89" stroke="url(#auth-flow-side-link-4-right)" />

          <path className="auth-flow-spine auth-flow-link-delay-1" d="M 50 19.5 V 32.5" stroke="url(#auth-flow-main-link-1)" />
          <path className="auth-flow-spine auth-flow-link-delay-2" d="M 50 44.5 V 57.5" stroke="url(#auth-flow-main-link-2)" />
          <path className="auth-flow-spine auth-flow-link-delay-3" d="M 50 69.5 V 82.5" stroke="url(#auth-flow-main-link-3)" />
        </g>
      </svg>

      <style>
        {`
          @keyframes authFlowLinkPulse {
            0%, 100% { opacity: 0.65; }
            50% { opacity: 1; }
          }

          @keyframes authFlowDashTravel {
            to { stroke-dashoffset: -14; }
          }

          @keyframes authFlowNodeGlow {
            0%, 100% { box-shadow: 0 0 0 rgba(2, 6, 23, 0.25); }
            50% { box-shadow: 0 0 0.8rem rgba(56, 189, 248, 0.18); }
          }

          @keyframes authFlowChipBreath {
            0%, 100% { opacity: 0.9; }
            50% { opacity: 1; }
          }

          .auth-flow-link {
            animation: authFlowLinkPulse 3.6s ease-in-out infinite;
          }

          .auth-flow-link-delay-0 { animation-delay: 0s; }
          .auth-flow-link-delay-1 { animation-delay: 0.35s; }
          .auth-flow-link-delay-2 { animation-delay: 0.7s; }
          .auth-flow-link-delay-3 { animation-delay: 1.05s; }

          .auth-flow-spine {
            stroke-dasharray: 3 4;
            animation:
              authFlowDashTravel 1.8s linear infinite,
              authFlowLinkPulse 4.2s ease-in-out infinite;
          }

          .auth-flow-node-frame {
            animation: authFlowNodeGlow 5.2s ease-in-out infinite;
          }

          .auth-flow-chip {
            animation: authFlowChipBreath 4.6s ease-in-out infinite;
          }

          @media (prefers-reduced-motion: reduce) {
            .auth-flow-link,
            .auth-flow-spine,
            .auth-flow-node-frame,
            .auth-flow-chip {
              animation: none !important;
            }
          }
        `}
      </style>

      <NodeCard
        title="frontend-app"
        subtitle="presentation layer"
        icon={<Workflow className="h-[18px] w-[18px] text-cyan-400" />}
        colorClass="border-cyan-500/45 shadow-[0_0_22px_rgba(34,211,238,0.22)]"
        className={`${nodeClass} top-[14%]`}
      />
      <NodeCard
        title="api-gateway"
        subtitle="service orchestration"
        icon={<Server className="h-[18px] w-[18px] text-emerald-400" />}
        colorClass="border-emerald-500/50 shadow-[0_0_26px_rgba(16,185,129,0.25)]"
        className={`${nodeClass} top-[39%]`}
      />
      <NodeCard
        title="worker-queue"
        subtitle="async execution"
        icon={<Boxes className="h-[18px] w-[18px] text-sky-400" />}
        colorClass="border-sky-500/45 shadow-[0_0_22px_rgba(14,165,233,0.25)]"
        className={`${nodeClass} top-[64%]`}
      />
      <NodeCard
        title="security-scan"
        subtitle="quality controls"
        icon={<Shield className="h-[18px] w-[18px] text-amber-400" />}
        colorClass="border-amber-500/45 shadow-[0_0_22px_rgba(245,158,11,0.2)]"
        className={`${nodeClass} top-[89%]`}
      />

      <MiniChip
        label="pages"
        icon={<FileCode2 className="h-4 w-4 text-cyan-300" />}
        className={`${chipClass} left-[8%] top-[9%] border-cyan-500/35`}
      />
      <MiniChip
        label="routes"
        icon={<Route className="h-4 w-4 text-cyan-300" />}
        className={`${chipClass} right-[8%] top-[20%] border-cyan-500/35`}
      />
      <MiniChip
        label="/auth"
        icon={<Server className="h-4 w-4 text-emerald-300" />}
        className={`${chipClass} left-[8%] top-[43%] border-emerald-500/35`}
      />
      <MiniChip
        label="ws-events"
        icon={<Zap className="h-4 w-4 text-emerald-300" />}
        className={`${chipClass} right-[8%] top-[34%] border-emerald-500/35`}
      />
      <MiniChip
        label="jobs"
        icon={<Boxes className="h-4 w-4 text-sky-300" />}
        className={`${chipClass} left-[8%] top-[60%] border-sky-500/35`}
      />
      <MiniChip
        label="runtime"
        icon={<Container className="h-4 w-4 text-sky-300" />}
        className={`${chipClass} right-[8%] top-[71%] border-sky-500/35`}
      />
      <MiniChip
        label="hadolint"
        icon={<Shield className="h-4 w-4 text-amber-300" />}
        className={`${chipClass} left-[8%] top-[93%] border-amber-500/35`}
      />
      <MiniChip
        label="vuln scan"
        icon={<ShieldAlert className="h-4 w-4 text-amber-300" />}
        className={`${chipClass} right-[8%] top-[83%] border-amber-500/35`}
      />
    </div>
  );
}

export function AuthShell({ mode, children }: AuthShellProps) {
  const vantaRef = useRef<HTMLDivElement | null>(null);
  const vantaEffectRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const initVantaWaves = async () => {
      if (!vantaRef.current || vantaEffectRef.current) return;

      try {
        const THREE = await import("three-vanta");
        (globalThis as { THREE?: unknown }).THREE = THREE;
        const vantaModule = await import("vanta/dist/vanta.waves.min");

        if (isCancelled || !vantaRef.current) return;

        const globalVanta = (globalThis as { VANTA?: { WAVES?: unknown } }).VANTA;
        const WAVES = (globalVanta?.WAVES ??
          (vantaModule as { default?: unknown }).default ??
          (vantaModule as { WAVES?: unknown }).WAVES) as
          | ((options: Record<string, unknown>) => { destroy: () => void })
          | undefined;

        if (typeof WAVES !== "function") {
          throw new Error("Vanta WAVES effect did not load as a callable module.");
        }

        vantaEffectRef.current = WAVES({
          el: vantaRef.current,
          THREE,
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          scale: 1,
          scaleMobile: 1,
          backgroundColor: 0x01040f,
          color: 0x1e3a8a,
          shininess: 64,
          waveHeight: 20,
          waveSpeed: 0.85,
          zoom: 0.88,
        });
      } catch (error) {
        console.error("Failed to initialize Vanta waves background:", error);
      }
    };

    void initVantaWaves();

    return () => {
      isCancelled = true;
      vantaEffectRef.current?.destroy();
      vantaEffectRef.current = null;
      delete (globalThis as { THREE?: unknown }).THREE;
    };
  }, []);

  const whaleAgents = [
    { top: "6%", left: "5%", size: 186, duration: 18, delay: -3 },
    { top: "12%", left: "52%", size: 204, duration: 20, delay: -8 },
    { top: "18%", left: "82%", size: 174, duration: 21, delay: -5 },
    { top: "24%", left: "28%", size: 228, duration: 22, delay: -1 },
    { top: "31%", left: "66%", size: 192, duration: 19, delay: -11 },
    { top: "38%", left: "9%", size: 216, duration: 24, delay: -6 },
    { top: "46%", left: "44%", size: 240, duration: 23, delay: -14 },
    { top: "54%", left: "79%", size: 180, duration: 20, delay: -9 },
    { top: "61%", left: "18%", size: 210, duration: 25, delay: -4 },
    { top: "69%", left: "58%", size: 246, duration: 24, delay: -12 },
    { top: "76%", left: "87%", size: 186, duration: 20, delay: -16 },
    { top: "84%", left: "34%", size: 234, duration: 23, delay: -7 },
    { top: "90%", left: "70%", size: 198, duration: 22, delay: -10 },
    { top: "95%", left: "10%", size: 174, duration: 19, delay: -13 },
  ] as const;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950">
      <div className="absolute inset-0">
        <div ref={vantaRef} className="auth-vanta-layer absolute inset-0" />
        <div className="pointer-events-none absolute inset-0">
          {whaleAgents.map((whale, index) => (
            <div
              key={`bg-whale-${whale.top}-${whale.left}-${index}`}
              className="auth-floating-whale"
              style={
                {
                  top: whale.top,
                  left: whale.left,
                  width: `${whale.size}px`,
                  height: `${Math.round(whale.size * 0.62)}px`,
                  animationDuration: `${whale.duration}s`,
                  animationDelay: `${whale.delay}s`,
                } as CSSProperties
              }
            >
              <svg viewBox="0 0 120 80" className="h-full w-full">
                <g fill="none" stroke="rgba(12,74,110,0.95)" strokeWidth="2.2">
                  <path d="M10 50 Q35 28 68 36 Q80 30 94 34 Q100 26 113 24 Q107 34 112 45 Q106 43 98 45 Q89 50 82 58 Q62 74 33 66 Q20 62 10 50 Z" fill="rgba(8,27,48,0.72)" />
                  <rect x="47" y="18" width="7" height="6" rx="1.3" fill="rgba(14,116,144,0.58)" stroke="none" />
                  <rect x="56" y="18" width="7" height="6" rx="1.3" fill="rgba(14,116,144,0.58)" stroke="none" />
                  <rect x="65" y="18" width="7" height="6" rx="1.3" fill="rgba(14,116,144,0.58)" stroke="none" />
                  <circle cx="33.5" cy="48" r="3" fill="rgba(224,242,254,0.92)" stroke="none" />
                  <circle cx="33.2" cy="48.2" r="1.45" fill="rgba(8,47,73,0.92)" stroke="none" />
                  <circle cx="32.7" cy="47.35" r="0.6" fill="rgba(255,255,255,0.9)" stroke="none" />
                </g>
              </svg>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-slate-950/8" />
      </div>

      <style>
        {`
          .auth-vanta-layer {
            opacity: 0.44;
            mix-blend-mode: screen;
          }

          @keyframes authWhaleFloat {
            0%, 100% { transform: translate3d(0, 0, 0) rotate(-3deg); }
            20% { transform: translate3d(16px, -18px, 0) rotate(2deg); }
            45% { transform: translate3d(-10px, -28px, 0) rotate(-1.6deg); }
            70% { transform: translate3d(18px, -12px, 0) rotate(2.4deg); }
          }

          .auth-floating-whale {
            position: absolute;
            opacity: 0.86;
            filter: drop-shadow(0 0 12px rgba(8, 47, 73, 0.42));
            animation: authWhaleFloat ease-in-out infinite;
            will-change: transform;
          }

          @media (prefers-reduced-motion: reduce) {
            .auth-vanta-layer {
              opacity: 0.18;
            }
            .auth-floating-whale {
              animation: none !important;
              opacity: 0.28;
            }
          }
        `}
      </style>

      <div className="relative mx-auto grid min-h-screen max-w-7xl grid-cols-1 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden min-h-0 flex-col border-r border-slate-800/80 px-10 py-12 lg:flex">
          <div className="shrink-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-500/80 bg-slate-950/88 px-3 py-1 text-xs text-white">
              <FileCode2 className="h-3.5 w-3.5 text-sky-400" />
              Docker Quality Analyzer
            </div>
            <div className="mt-6 w-full rounded-xl border border-slate-500/80 bg-slate-950/88 p-4">
              <h1 className="text-4xl font-semibold leading-tight text-white">
                Analyze Docker quality with confidence.
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-slate-200">
                Lint, security, runnability, and project-level insights in one place. Sign in to continue
                monitoring your container workflows.
              </p>
            </div>
          </div>

          <div className="mt-8 flex min-h-0 flex-1">
            <ContainerFlowPanel />
          </div>

          <div className="mt-6 shrink-0 rounded-xl border border-slate-500/80 bg-slate-950/88 p-4">
            <div className="text-sm font-medium text-white">
              {mode === "login" ? "Welcome back" : "Create your workspace"}
            </div>
            <div className="mt-1 text-xs text-slate-200">
              Rebuilt flow scene with clearer links and stronger node hierarchy.
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-4 py-10 sm:px-8">
          <div className="absolute inset-x-0 top-5 flex items-center justify-center lg:hidden">
            <div className="relative w-full max-w-sm rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-300">
                <FileCode2 className="h-3 w-3 text-sky-400" />
                Docker Quality Analyzer
              </div>
              <FloatingTile
                className="absolute right-3 top-2 rounded-lg border border-slate-700 bg-slate-900/80 p-1.5"
                icon={<Container className="h-3.5 w-3.5 text-emerald-400" />}
              />
              <FloatingTile
                className="absolute bottom-2 right-12 rounded-lg border border-slate-700 bg-slate-900/80 p-1.5"
                icon={<Boxes className="h-3.5 w-3.5 text-sky-400" />}
              />
            </div>
          </div>
          <div className="w-full max-w-lg">{children}</div>
        </section>
      </div>
    </div>
  );
}