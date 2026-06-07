import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ExternalLink,
  Globe,
  PlugZap,
  RefreshCw,
  Terminal,
  XCircle,
} from "lucide-react";

import { Layout } from "../components/Layout";
import { ContainerMetricsPanel } from "../components/monitoring/ContainerMetricsPanel";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { DockerLoader } from "../components/DockerLoader";
import { useAuth } from "../auth/AuthProvider";
import { MotionPage } from "../components/motion";
import { motion, useReducedMotion } from "motion/react";
import {
  buildPreviewProxyEmbedUrl,
  compose as composeApi,
  safeCloseSocket,
  ws,
  type ContainerLogPayload,
  type ContainerMetricsPayload,
  type DeployRuntimeState,
  type DeployStatusResponse,
  type DomainEvent,
  type PreviewCheckResponse,
  type RuntimeContainerState,
} from "../utils/api";
import {
  appendMetricSample,
  PERSIST_METRIC_POINTS,
  trimPayloadForPersist,
  type MetricSample,
} from "../utils/metricsSeries";
import { collectBrowserProxyHints, openPopOutPreview } from "../utils/previewBrowser";
import { localPreviewIssue } from "../utils/previewCheck";
import { clearSessionStopping, isSessionStopping } from "../utils/deploySession";
import { loadState, saveState } from "../utils/monitoringState";

type LogStream = "stdout" | "stderr" | "system";
type LogTone = "info" | "warning" | "error" | "system";

interface LogLine {
  stream: LogStream;
  line: string;
  timestamp?: string | null;
  tone: LogTone;
}

interface PreviewTarget {
  key: string;
  label: string;
  url: string;
  port: number | null;
  service: string | null;
}

interface PersistedMetricsState {
  points: MetricSample[];
  latest: ContainerMetricsPayload | null;
}

interface PersistedMonitoringState {
  selectedPreviewUrl: string;
  previewAddress: string;
  logsByContainer: Record<string, LogLine[]>;
  metricsByContainer?: Record<string, PersistedMetricsState>;
}

const MONITORING_STATE_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_LOG_LINES = 400;
const PERSIST_LOG_LINES = 200;
const DEPLOY_POLL_MS = 4000;
const DEPLOY_POLL_FAST_MS = 1000;
const WEB_PORT_PRIORITY = [80, 3000, 5173, 8000, 8080, 5000];
const TERMINAL_CONTAINER_STATUSES = new Set(["exited", "dead", "removing"]);
const TERMINAL_RUNTIME_STATES = new Set<DeployRuntimeState>([
  "none",
  "exited",
  "failed",
  "stopped_by_user",
  "cleanup_completed",
]);
const ERROR_PATTERN = /(error|exception|fatal|traceback|panic|fail(ed|ure)?)/i;

function normalizeContainerPort(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const [port] = trimmed.split("/");
  return port && /^\d+$/.test(port) ? Number(port) : null;
}

function isLoopbackBinding(hostIp: string): boolean {
  const normalized = hostIp.trim();
  return normalized === "0.0.0.0" || normalized === "::" || normalized === ":::" || normalized === "";
}

function classifyLogTone(stream: LogStream, line: string): LogTone {
  if (stream === "system") return "system";
  if (ERROR_PATTERN.test(line)) return "error";
  if (stream === "stderr") return "warning";
  return "info";
}

function lastLogsToEntries(lastLogs: string[] | null | undefined): LogLine[] {
  return (lastLogs ?? [])
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .map((line) => ({
      stream: "stdout" as const,
      line,
      timestamp: null,
      tone: classifyLogTone("stdout", line),
    }));
}

function buildPreviewTargets(
  containers: RuntimeContainerState[],
  dindIp: string | null,
): PreviewTarget[] {
  const hostname =
    typeof window !== "undefined" && window.location.hostname
      ? window.location.hostname
      : "localhost";
  const seen = new Set<string>();
  const candidates: PreviewTarget[] = [];

  for (const container of containers) {
    const service = container.service || container.name || null;
    for (const portInfo of container.ports ?? []) {
      const containerPort = normalizeContainerPort(portInfo.container_port);
      for (const binding of portInfo.host_bindings ?? []) {
        const rawHostIp = String(binding.host_ip ?? "").trim();
        const hostPort = String(binding.host_port ?? "").trim();
        if (!hostPort) continue;
        const host = isLoopbackBinding(rawHostIp) ? dindIp || hostname : rawHostIp;
        const url = `http://${host}:${hostPort}`;
        if (seen.has(url)) continue;
        seen.add(url);
        candidates.push({
          key: `${container.id}-${host}-${hostPort}`,
          label: `${service ? `${service} ` : ""}${host}:${hostPort}${containerPort ? ` -> ${containerPort}` : ""}`,
          url,
          port: containerPort,
          service,
        });
      }
    }
  }

  candidates.sort((a, b) => {
    const ai = a.port != null ? WEB_PORT_PRIORITY.indexOf(a.port) : -1;
    const bi = b.port != null ? WEB_PORT_PRIORITY.indexOf(b.port) : -1;
    const aRank = ai === -1 ? WEB_PORT_PRIORITY.length : ai;
    const bRank = bi === -1 ? WEB_PORT_PRIORITY.length : bi;
    return aRank - bRank;
  });

  return candidates;
}

function containerStatusBadge(
  container: RuntimeContainerState,
  shuttingDown = false,
): {
  label: string;
  className: string;
  dotClassName: string;
} {
  const status = (container.status ?? "").toLowerCase();
  const health = (container.health_status ?? "").toLowerCase();
  if (
    shuttingDown &&
    !TERMINAL_CONTAINER_STATUSES.has(status) &&
    status !== "exited"
  ) {
    return {
      label: "Stopping",
      className: "border-slate-600 bg-slate-800/80 text-slate-300",
      dotClassName: "bg-slate-400",
    };
  }
  if (TERMINAL_CONTAINER_STATUSES.has(status) || status === "exited") {
    return {
      label: `Exited${container.exit_code != null ? ` (${container.exit_code})` : ""}`,
      className: "border-red-500/40 bg-red-500/10 text-red-300",
      dotClassName: "bg-red-500",
    };
  }
  if (health === "unhealthy") {
    return {
      label: "Unhealthy",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
      dotClassName: "bg-amber-400",
    };
  }
  if (["running", "paused", "restarting"].includes(status)) {
    return {
      label: status === "running" ? "Running" : status.charAt(0).toUpperCase() + status.slice(1),
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
      dotClassName: "bg-emerald-400",
    };
  }
  return {
    label: container.status ?? "Unknown",
    className: "border-slate-700 bg-slate-900 text-slate-400",
    dotClassName: "bg-slate-600",
  };
}

function containerLabel(container: RuntimeContainerState): string {
  return container.service || container.name || container.id.slice(0, 12);
}

function logToneClass(tone: LogTone): string {
  switch (tone) {
    case "error":
      return "text-red-300";
    case "warning":
      return "text-amber-300";
    case "system":
      return "text-cyan-300/80";
    default:
      return "text-slate-300";
  }
}

function formatLogTimestamp(timestamp?: string | null): string {
  if (!timestamp) return "";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString();
}

interface RuntimeStatusBannerProps {
  runtimeState: DeployRuntimeState;
  stoppedByUser: boolean;
  exitReason?: string | null;
  onAcknowledge: () => void;
}

function RuntimeStatusBanner({
  runtimeState,
  stoppedByUser,
  exitReason,
  onAcknowledge,
}: RuntimeStatusBannerProps) {
  if (runtimeState === "stopping") {
    return (
      <Card className="p-3 bg-slate-900 border-slate-700 mb-3">
        <div className="flex items-center gap-3">
          <PlugZap className="w-4 h-4 text-slate-400 shrink-0" />
          <p className="text-xs text-slate-300">
            Stop in progress. Container status may still show running until Docker finishes shutdown.
          </p>
        </div>
      </Card>
    );
  }

  if (stoppedByUser || runtimeState === "stopped_by_user") {
    return (
      <Card className="p-3 bg-slate-900 border-slate-700 mb-3">
        <div className="flex items-center gap-3">
          <PlugZap className="w-4 h-4 text-slate-400 shrink-0" />
          <p className="text-xs text-slate-300">
            Stopped by user. Final logs remain available below if the container captured any.
          </p>
        </div>
      </Card>
    );
  }

  const isProblematic =
    runtimeState === "failed" ||
    runtimeState === "exited" ||
    runtimeState === "partial" ||
    runtimeState === "unhealthy" ||
    runtimeState === "cleanup_completed";

  if (!isProblematic) return null;

  return (
    <Card className="p-4 bg-red-950/25 border-red-800 mb-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-red-300 mb-1">
            Stack is {runtimeState === "partial" ? "partially running" : runtimeState}
          </h2>
          <p className="text-xs text-red-200/80">
            Inspect the container logs below to understand what went wrong.
            {exitReason ? ` Reason: ${exitReason}.` : ""}
          </p>
          <p className="text-xs text-red-200/60 mt-1">
            Return to Results to fix the stack and upload/deploy again. Analysis remains available there.
          </p>
        </div>
        <Button size="sm" onClick={onAcknowledge} className="bg-red-700 hover:bg-red-800">
          Go to Results
        </Button>
      </div>
    </Card>
  );
}

interface AppPreviewBrowserProps {
  targets: PreviewTarget[];
  selectedTargetUrl: string;
  onSelectTarget: (url: string) => void;
  address: string;
  onAddressChange: (value: string) => void;
  src: string;
  reloadTick: number;
  canGoBack: boolean;
  canGoForward: boolean;
  onSubmit: () => void;
  onReload: () => void;
  onBack: () => void;
  onForward: () => void;
}

type PreviewGate = "pending" | "embed" | "blocked";
type PreviewDisplayMode = "popout" | "inline";
type InlinePreviewKind = "direct" | "proxy";

const PREVIEW_MODE_STORAGE_KEY = "dqa:previewDisplayMode";

function loadPreviewDisplayMode(): PreviewDisplayMode {
  if (typeof sessionStorage === "undefined") return "inline";
  const stored = sessionStorage.getItem(PREVIEW_MODE_STORAGE_KEY);
  return stored === "popout" ? "popout" : "inline";
}

function AppPreviewBrowser({
  targets,
  selectedTargetUrl,
  onSelectTarget,
  address,
  onAddressChange,
  src,
  reloadTick,
  canGoBack,
  canGoForward,
  onSubmit,
  onReload,
  onBack,
  onForward,
}: AppPreviewBrowserProps) {
  const localIssue = src ? localPreviewIssue(src) : null;
  const [displayMode, setDisplayMode] = useState<PreviewDisplayMode>(loadPreviewDisplayMode);
  const [gate, setGate] = useState<PreviewGate>("pending");
  const [blockedMessage, setBlockedMessage] = useState("");
  const [embedSrc, setEmbedSrc] = useState("");
  const [resolvedUrl, setResolvedUrl] = useState("");
  const [inlineKind, setInlineKind] = useState<InlinePreviewKind>("direct");
  const popoutOpenedForRef = useRef<string>("");
  const previewUrl = resolvedUrl || src;

  const handleDisplayModeChange = useCallback((mode: PreviewDisplayMode) => {
    setDisplayMode(mode);
    sessionStorage.setItem(PREVIEW_MODE_STORAGE_KEY, mode);
  }, []);

  const openRealBrowser = useCallback((url: string) => {
    const opened = openPopOutPreview(url);
    if (!opened) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  useEffect(() => {
    if (!src || localIssue) return;

    if (displayMode === "popout") {
      const popoutKey = `${src}:${reloadTick}`;
      if (popoutOpenedForRef.current !== popoutKey) {
        popoutOpenedForRef.current = popoutKey;
        openRealBrowser(src);
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const result: PreviewCheckResponse = await composeApi.checkPreview(src);
        if (cancelled) return;
        const targetUrl = result.final_url ?? src;
        setResolvedUrl(targetUrl);
        if (!result.frameable && result.proxy_available) {
          const session = await composeApi.createPreviewProxySession(
            targetUrl,
            collectBrowserProxyHints(),
          );
          setEmbedSrc(buildPreviewProxyEmbedUrl(session.session_id));
          setInlineKind("proxy");
          setGate("embed");
          return;
        }
        if (!result.frameable) {
          setBlockedMessage(
            result.reason ??
              (result.reachable
                ? "This app cannot be shown in an embedded preview."
                : "Could not reach this URL from the platform."),
          );
          setGate("blocked");
          return;
        }
        setEmbedSrc(targetUrl);
        setInlineKind("direct");
        setGate("embed");
      } catch {
        if (cancelled) return;
        setBlockedMessage(
          "Could not verify whether this URL allows in-app preview. Open it in a new tab instead.",
        );
        setGate("blocked");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, reloadTick, localIssue, displayMode, openRealBrowser]);

  const handlePopOut = useCallback(() => {
    const url = previewUrl;
    if (!url) return;
    popoutOpenedForRef.current = `${url}:${reloadTick}`;
    openRealBrowser(url);
  }, [previewUrl, reloadTick, openRealBrowser]);

  const handleReloadPreview = useCallback(() => {
    if (displayMode === "popout") {
      handlePopOut();
      return;
    }
    onReload();
  }, [displayMode, handlePopOut, onReload]);

  let previewBody: ReactNode;
  if (!src) {
    previewBody = (
      <div className="flex-1 min-h-[420px] flex items-center justify-center p-4">
        <p className="text-xs text-slate-500 text-center max-w-sm">
          No accessible web port detected yet. Once a container publishes a host port, the preview
          appears here. You can also type a URL above.
        </p>
      </div>
    );
  } else if (displayMode === "popout") {
    previewBody = (
      <div className="flex-1 min-h-[420px] flex flex-col items-center justify-center gap-4 p-6 text-center">
        <Globe className="w-10 h-10 text-cyan-400/80" />
        <div className="max-w-md space-y-2">
          <p className="text-sm font-medium text-slate-200">Real browser preview</p>
          <p className="text-xs text-slate-400">
            The app opens in a separate window with the real container URL — the same as pasting the
            address into Chrome or Firefox. That avoids iframe limits and proxy quirks.
          </p>
          <p className="text-[11px] text-slate-500 font-mono break-all">{previewUrl}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" className="bg-cyan-600 hover:bg-cyan-700" onClick={handlePopOut}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Open / focus preview window
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-700 text-slate-300"
            onClick={() => handleDisplayModeChange("inline")}
          >
            Try inline preview
          </Button>
        </div>
      </div>
    );
  } else if (localIssue || gate === "blocked") {
    previewBody = (
      <div className="flex-1 min-h-[420px] flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0" />
        <div className="max-w-md space-y-1">
          <p className="text-sm font-medium text-slate-200">In-app preview unavailable</p>
          <p className="text-xs text-slate-400">{localIssue ?? blockedMessage}</p>
          <p className="text-[11px] text-slate-500 font-mono break-all">{src}</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          <Button size="sm" className="bg-cyan-600 hover:bg-cyan-700" onClick={handlePopOut}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Open in browser window
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-700 text-slate-300"
            onClick={() => handleDisplayModeChange("popout")}
          >
            Use real browser mode
          </Button>
        </div>
      </div>
    );
  } else if (gate === "pending") {
    previewBody = (
      <div className="flex-1 min-h-[420px] flex items-center justify-center p-4">
        <p className="text-xs text-slate-400">Checking whether this app allows in-app preview…</p>
      </div>
    );
  } else {
    previewBody = (
      <iframe
        key={`${reloadTick}:${embedSrc}`}
        src={embedSrc}
        title="Container app preview"
        className="w-full flex-1 min-h-[420px] bg-slate-100"
        style={{ colorScheme: "light" }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation"
      />
    );
  }

  return (
    <Card className="p-3 bg-slate-900 border-slate-800 flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-xs font-semibold text-slate-400 flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          Live App Preview
        </h3>
        <div className="flex items-center gap-1 rounded border border-slate-700 p-0.5">
          <button
            type="button"
            onClick={() => handleDisplayModeChange("popout")}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              displayMode === "popout"
                ? "bg-cyan-600/30 text-cyan-200"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            Browser window
          </button>
          <button
            type="button"
            onClick={() => handleDisplayModeChange("inline")}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              displayMode === "inline"
                ? "bg-cyan-600/30 text-cyan-200"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            Inline
          </button>
        </div>
        {targets.length > 1 && (
          <select
            value={selectedTargetUrl}
            onChange={(e) => onSelectTarget(e.target.value)}
            aria-label="Preview target"
            className="h-8 max-w-[260px] rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 font-mono"
          >
            {targets.map((target) => (
              <option key={target.key} value={target.url}>
                {target.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-1.5 mb-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!canGoBack}
          onClick={onBack}
          aria-label="Back"
          className="border-slate-700 text-slate-300 hover:bg-slate-800 px-2"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canGoForward}
          onClick={onForward}
          aria-label="Forward"
          className="border-slate-700 text-slate-300 hover:bg-slate-800 px-2"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!src}
          onClick={handleReloadPreview}
          aria-label="Reload"
          className="border-slate-700 text-slate-300 hover:bg-slate-800 px-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
        <form
          className="flex-1 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <input
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="http://host:port"
            spellCheck={false}
            className="flex-1 h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 font-mono outline-none focus:border-cyan-500/50"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!address.trim()}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Go
          </Button>
        </form>
        <Button
          size="sm"
          variant="outline"
          disabled={!src}
          onClick={handlePopOut}
          aria-label="Open in browser window"
          className="border-slate-700 text-slate-300 hover:bg-slate-800 px-2"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Button>
      </div>
      {displayMode === "inline" && gate === "embed" && inlineKind === "proxy" && (
        <p className="text-[10px] text-amber-300/90 mb-2">
          Inline proxy mode — some apps break here. Switch to{" "}
          <button
            type="button"
            className="underline hover:text-amber-200"
            onClick={() => handleDisplayModeChange("popout")}
          >
            Browser window
          </button>{" "}
          for the same behavior as opening the URL directly.
        </p>
      )}

      <div className="rounded border border-slate-800 bg-slate-950 overflow-hidden flex-1 min-h-[420px] flex flex-col">
        {previewBody}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        <span className="font-semibold text-slate-400">Browser window</span> uses the real container
        URL (recommended). <span className="font-semibold text-slate-400">Inline</span> embeds in
        this page via iframe or proxy. Do not use <span className="font-mono">localhost:8000</span>.
      </p>
    </Card>
  );
}

interface ContainerLogPanelProps {
  container: RuntimeContainerState;
  liveLines: LogLine[];
  connected: boolean;
}

function ContainerLogPanel({ container, liveLines, connected }: ContainerLogPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const fallbackLines = useMemo<LogLine[]>(() => {
    if (liveLines.length > 0) return [];
    return lastLogsToEntries(container.last_logs);
  }, [liveLines.length, container.last_logs]);

  const lines = liveLines.length > 0 ? liveLines : fallbackLines;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  const status = (container.status ?? "").toLowerCase();
  const isExited = TERMINAL_CONTAINER_STATUSES.has(status) || status === "exited";

  return (
    <div className="flex flex-col h-[420px] rounded border border-slate-800 bg-slate-950 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800 bg-slate-900/70">
        <span className="flex items-center gap-2 text-xs text-slate-300 font-mono truncate">
          <Terminal className="w-3.5 h-3.5 text-green-400 shrink-0" />
          {containerLabel(container)}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          {!isExited &&
            (connected ? (
              <span className="text-emerald-400">live</span>
            ) : (
              <span className="text-slate-500">connecting…</span>
            ))}
          {isExited && lines.length > 0 && <span className="text-slate-500">final logs</span>}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-3 font-mono text-xs"
      >
        {lines.length === 0 ? (
          <div className="text-slate-500 italic">
            {isExited ? "No logs were captured for this container." : "Waiting for logs…"}
          </div>
        ) : (
          lines.map((entry, index) => (
            <div
              key={index}
              className={`${logToneClass(entry.tone)} mb-0.5 whitespace-pre-wrap break-all`}
            >
              {entry.timestamp && (
                <span className="text-slate-600 mr-2">[{formatLogTimestamp(entry.timestamp)}]</span>
              )}
              {entry.stream === "stderr" && <span className="text-amber-500/70 mr-1">stderr</span>}
              {entry.line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function Monitoring() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { jobId, containerId: routeContainerId } = useParams<{
    jobId: string;
    containerId?: string;
  }>();
  const { user } = useAuth();
  const stateKey = jobId ? `dqa:monitoring:${jobId}` : null;
  const persisted =
    stateKey != null
      ? loadState<PersistedMonitoringState>(stateKey, MONITORING_STATE_TTL_MS)
      : null;

  const [status, setStatus] = useState<DeployStatusResponse | null>(null);
  const [dindIp, setDindIp] = useState<string | null>(null);
  const [logsByContainer, setLogsByContainer] = useState<Record<string, LogLine[]>>(
    () => persisted?.logsByContainer ?? {},
  );
  const [connectionByContainer, setConnectionByContainer] = useState<Record<string, boolean>>({});
  const [metricsByContainer, setMetricsByContainer] = useState<
    Record<string, { points: MetricSample[]; latest: ContainerMetricsPayload | null }>
  >(() => {
    const initial: Record<string, { points: MetricSample[]; latest: ContainerMetricsPayload | null }> =
      {};
    if (persisted?.metricsByContainer) {
      for (const [id, entry] of Object.entries(persisted.metricsByContainer)) {
        initial[id] = {
          points: entry.points ?? [],
          latest: entry.latest ?? null,
        };
      }
    }
    return initial;
  });
  const [metricsConnectedByContainer, setMetricsConnectedByContainer] = useState<
    Record<string, boolean>
  >({});
  const [focusedContainerId, setFocusedContainerId] = useState<string | null>(
    routeContainerId ?? null,
  );

  const [selectedTargetUrl, setSelectedTargetUrl] = useState<string>(
    persisted?.selectedPreviewUrl ?? "",
  );
  const [previewAddress, setPreviewAddress] = useState<string>(
    persisted?.previewAddress ?? persisted?.selectedPreviewUrl ?? "",
  );
  const [previewSrc, setPreviewSrc] = useState<string>(persisted?.selectedPreviewUrl ?? "");
  const [previewReloadTick, setPreviewReloadTick] = useState(0);
  const [history, setHistory] = useState<string[]>(
    persisted?.selectedPreviewUrl ? [persisted.selectedPreviewUrl] : [],
  );
  const [historyIndex, setHistoryIndex] = useState<number>(
    persisted?.selectedPreviewUrl ? 0 : -1,
  );

  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const socketGenByContainerRef = useRef<Map<string, number>>(new Map());
  const metricsSocketsRef = useRef<Map<string, WebSocket>>(new Map());
  const metricsSocketGenByContainerRef = useRef<Map<string, number>>(new Map());
  const previewInitializedRef = useRef<boolean>(Boolean(persisted?.selectedPreviewUrl));

  const invalidateContainerSocket = useCallback((containerId: string) => {
    socketGenByContainerRef.current.set(
      containerId,
      (socketGenByContainerRef.current.get(containerId) ?? 0) + 1,
    );
  }, []);

  const invalidateMetricsSocket = useCallback((containerId: string) => {
    metricsSocketGenByContainerRef.current.set(
      containerId,
      (metricsSocketGenByContainerRef.current.get(containerId) ?? 0) + 1,
    );
  }, []);

  const closeOpenSocket = useCallback((socket: WebSocket) => {
    safeCloseSocket(socket);
  }, []);

  const containers = useMemo<RuntimeContainerState[]>(
    () => status?.containers ?? [],
    [status?.containers],
  );
  const runtimeState: DeployRuntimeState = status?.runtime_state ?? "none";
  const shuttingDown = runtimeState === "stopping" || isSessionStopping(jobId ?? undefined);

  const displayContainers = useMemo<RuntimeContainerState[]>(() => {
    if (containers.length > 0) return containers;
    const ids = status?.container_ids?.length
      ? status.container_ids
      : routeContainerId
      ? [routeContainerId]
      : [];
    return ids.map((id) => ({ id }) as RuntimeContainerState);
  }, [containers, status?.container_ids, routeContainerId]);

  const liveContainerIds = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const c of containers) {
      const st = (c.status ?? "").toLowerCase();
      if (st && !TERMINAL_CONTAINER_STATUSES.has(st)) set.add(c.id);
    }
    if (set.size === 0 && status?.active) {
      for (const id of status.container_ids ?? []) set.add(id);
    }
    return Array.from(set);
  }, [containers, status?.active, status?.container_ids]);
  const liveContainerKey = liveContainerIds.join(",");

  const previewTargets = useMemo(
    () => buildPreviewTargets(displayContainers, dindIp),
    [displayContainers, dindIp],
  );

  // Resolve the focused container for the log tabs (route id is an optional initial hint only).
  useEffect(() => {
    if (displayContainers.length === 0) return;
    setFocusedContainerId((current) => {
      if (current && displayContainers.some((c) => c.id === current)) return current;
      return displayContainers[0].id;
    });
  }, [displayContainers]);

  // Poll deploy status (source of truth). Stop polling once the runtime is terminal.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const next = await composeApi.deployStatus(jobId);
        if (cancelled) return;
        setStatus(next);

        const rs = next.runtime_state ?? "none";
        const problematic =
          !next.stopped_by_user &&
          (rs === "failed" || rs === "exited" || rs === "partial" || rs === "unhealthy" || rs === "cleanup_completed");
        if (problematic) {
          sessionStorage.setItem(`dqa:resubmitRequired:${jobId}`, "1");
        }

        if (rs === "stopped_by_user" || rs === "none" || !next.active) {
          if (jobId) clearSessionStopping(jobId);
        }

        if (!TERMINAL_RUNTIME_STATES.has(rs)) {
          const pollMs =
            rs === "stopping" || isSessionStopping(jobId) ? DEPLOY_POLL_FAST_MS : DEPLOY_POLL_MS;
          timer = setTimeout(poll, pollMs);
        }
      } catch {
        if (!cancelled) {
          timer = setTimeout(poll, DEPLOY_POLL_MS);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  // Seed log panels from deployStatus.last_logs (survives refresh / late page open).
  useEffect(() => {
    const fromStatus = status?.containers ?? [];
    if (fromStatus.length === 0) return;

    setLogsByContainer((prev) => {
      const next = { ...prev };
      for (const container of fromStatus) {
        const fromDeploy = lastLogsToEntries(container.last_logs);
        if (fromDeploy.length === 0) continue;

        const existing = next[container.id] ?? [];
        if (existing.length === 0) {
          next[container.id] = fromDeploy.slice(-MAX_LOG_LINES);
          continue;
        }

        const seen = new Set(existing.map((entry) => entry.line));
        const merged = [...existing];
        for (const entry of fromDeploy) {
          if (seen.has(entry.line)) continue;
          seen.add(entry.line);
          merged.push(entry);
        }
        if (merged.length > existing.length) {
          next[container.id] = merged.slice(-MAX_LOG_LINES);
        }
      }
      return next;
    });
  }, [status?.containers]);

  // Resolve DinD IP once for loopback-bound preview targets.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = await composeApi.dindIp();
        if (!cancelled) {
          setDindIp(
            typeof resolved.dind_ip === "string" && resolved.dind_ip.trim()
              ? resolved.dind_ip
              : null,
          );
        }
      } catch {
        if (!cancelled) setDindIp(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize the preview target once when one first becomes available.
  useEffect(() => {
    if (previewInitializedRef.current) return;
    if (previewTargets.length === 0) return;
    const target = previewTargets[0].url;
    previewInitializedRef.current = true;
    setSelectedTargetUrl(target);
    setPreviewAddress(target);
    setPreviewSrc(target);
    setHistory([target]);
    setHistoryIndex(0);
    setPreviewReloadTick((v) => v + 1);
  }, [previewTargets]);

  // Open one live-logs websocket per active container. Stable across data updates.
  useEffect(() => {
    if (!user?.id || liveContainerIds.length === 0) return;
    const sockets = socketsRef.current;

    for (const cid of liveContainerIds) {
      if (sockets.has(cid)) continue;
      const connectionGen = (socketGenByContainerRef.current.get(cid) ?? 0) + 1;
      socketGenByContainerRef.current.set(cid, connectionGen);
      const socket = ws.connectUserContainerLogs(user.id, cid);
      sockets.set(cid, socket);

      socket.onopen = () => {
        if (socketGenByContainerRef.current.get(cid) !== connectionGen) {
          closeOpenSocket(socket);
          return;
        }
        setConnectionByContainer((prev) => ({ ...prev, [cid]: true }));
      };

      socket.onmessage = (event) => {
        if (socketGenByContainerRef.current.get(cid) !== connectionGen) return;
        try {
          const parsed = JSON.parse(event.data as string) as DomainEvent;
          if (parsed.event_name !== "container.log") return;
          const payload = parsed.payload as ContainerLogPayload;
          const stream: LogStream =
            payload.stream === "stderr" || payload.stream === "system" ? payload.stream : "stdout";
          const line = typeof payload.line === "string" ? payload.line : "";
          if (!line) return;
          const entry: LogLine = {
            stream,
            line,
            timestamp: payload.timestamp ?? parsed.timestamp,
            tone: classifyLogTone(stream, line),
          };
          setLogsByContainer((prev) => {
            const existing = prev[cid] ?? [];
            return { ...prev, [cid]: [...existing, entry].slice(-MAX_LOG_LINES) };
          });
        } catch {
          // ignore malformed frames
        }
      };

      socket.onerror = () => {
        if (socketGenByContainerRef.current.get(cid) !== connectionGen) return;
        setConnectionByContainer((prev) => ({ ...prev, [cid]: false }));
      };

      socket.onclose = () => {
        if (socketGenByContainerRef.current.get(cid) !== connectionGen) return;
        setConnectionByContainer((prev) => ({ ...prev, [cid]: false }));
        sockets.delete(cid);
      };
    }

    // Close sockets for containers no longer live.
    for (const [cid, socket] of sockets) {
      if (!liveContainerIds.includes(cid)) {
        invalidateContainerSocket(cid);
        closeOpenSocket(socket);
        sockets.delete(cid);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, liveContainerKey, closeOpenSocket, invalidateContainerSocket]);

  // Open one metrics websocket per active container.
  useEffect(() => {
    if (!user?.id || liveContainerIds.length === 0) return;
    const sockets = metricsSocketsRef.current;

    for (const cid of liveContainerIds) {
      if (sockets.has(cid)) continue;
      const connectionGen = (metricsSocketGenByContainerRef.current.get(cid) ?? 0) + 1;
      metricsSocketGenByContainerRef.current.set(cid, connectionGen);
      const socket = ws.connectUserContainer(user.id, cid);
      sockets.set(cid, socket);

      socket.onopen = () => {
        if (metricsSocketGenByContainerRef.current.get(cid) !== connectionGen) {
          closeOpenSocket(socket);
          return;
        }
        setMetricsConnectedByContainer((prev) => ({ ...prev, [cid]: true }));
      };

      socket.onmessage = (event) => {
        if (metricsSocketGenByContainerRef.current.get(cid) !== connectionGen) return;
        try {
          const parsed = JSON.parse(event.data as string) as DomainEvent;
          if (parsed.event_name !== "container.metrics") return;
          const payload = parsed.payload as ContainerMetricsPayload;
          setMetricsByContainer((prev) => {
            const existing = prev[cid] ?? { points: [], latest: null };
            const nextPoints = appendMetricSample(
              existing.points,
              payload,
              parsed.timestamp,
              existing.latest,
            );
            return {
              ...prev,
              [cid]: { points: nextPoints, latest: payload },
            };
          });
        } catch {
          // ignore malformed frames
        }
      };

      socket.onerror = () => {
        if (metricsSocketGenByContainerRef.current.get(cid) !== connectionGen) return;
        setMetricsConnectedByContainer((prev) => ({ ...prev, [cid]: false }));
      };

      socket.onclose = () => {
        if (metricsSocketGenByContainerRef.current.get(cid) !== connectionGen) return;
        setMetricsConnectedByContainer((prev) => ({ ...prev, [cid]: false }));
        sockets.delete(cid);
      };
    }

    for (const [cid, socket] of sockets) {
      if (!liveContainerIds.includes(cid)) {
        invalidateMetricsSocket(cid);
        closeOpenSocket(socket);
        sockets.delete(cid);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, liveContainerKey, closeOpenSocket, invalidateMetricsSocket]);

  // Close all sockets on unmount.
  useEffect(() => {
    const logSockets = socketsRef.current;
    const metricSockets = metricsSocketsRef.current;
    return () => {
      for (const [cid, socket] of logSockets) {
        invalidateContainerSocket(cid);
        closeOpenSocket(socket);
      }
      logSockets.clear();
      for (const [cid, socket] of metricSockets) {
        invalidateMetricsSocket(cid);
        closeOpenSocket(socket);
      }
      metricSockets.clear();
    };
  }, [closeOpenSocket, invalidateContainerSocket, invalidateMetricsSocket]);

  // Persist preview selection + recent logs + metrics samples.
  useEffect(() => {
    if (!stateKey) return;
    const trimmedLogs: Record<string, LogLine[]> = {};
    for (const [cid, lines] of Object.entries(logsByContainer)) {
      trimmedLogs[cid] = lines.slice(-PERSIST_LOG_LINES);
    }
    const trimmedMetrics: Record<string, PersistedMetricsState> = {};
    for (const [cid, entry] of Object.entries(metricsByContainer)) {
      trimmedMetrics[cid] = {
        points: entry.points.slice(-PERSIST_METRIC_POINTS),
        latest: entry.latest ? trimPayloadForPersist(entry.latest) : null,
      };
    }
    saveState<PersistedMonitoringState>(stateKey, {
      selectedPreviewUrl: selectedTargetUrl,
      previewAddress,
      logsByContainer: trimmedLogs,
      metricsByContainer: trimmedMetrics,
    });
  }, [stateKey, selectedTargetUrl, previewAddress, logsByContainer, metricsByContainer]);

  const historyIndexRef = useRef(historyIndex);
  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  const navigatePreview = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    const newIndex = historyIndexRef.current + 1;
    setHistory((prev) => [...prev.slice(0, historyIndexRef.current + 1), trimmed]);
    historyIndexRef.current = newIndex;
    setHistoryIndex(newIndex);
    setPreviewSrc(trimmed);
    setPreviewAddress(trimmed);
    setPreviewReloadTick((v) => v + 1);
  }, []);

  const handleSelectTarget = useCallback(
    (url: string) => {
      setSelectedTargetUrl(url);
      navigatePreview(url);
    },
    [navigatePreview],
  );

  const handleAddressSubmit = useCallback(() => {
    navigatePreview(previewAddress);
  }, [navigatePreview, previewAddress]);

  const handleReload = useCallback(() => {
    if (!previewSrc) return;
    setPreviewReloadTick((v) => v + 1);
  }, [previewSrc]);

  const handleBack = useCallback(() => {
    setHistoryIndex((index) => {
      if (index <= 0) return index;
      const nextIndex = index - 1;
      const url = history[nextIndex];
      setPreviewSrc(url);
      setPreviewAddress(url);
      setPreviewReloadTick((v) => v + 1);
      historyIndexRef.current = nextIndex;
      return nextIndex;
    });
  }, [history]);

  const handleForward = useCallback(() => {
    setHistoryIndex((index) => {
      if (index >= history.length - 1) return index;
      const nextIndex = index + 1;
      const url = history[nextIndex];
      setPreviewSrc(url);
      setPreviewAddress(url);
      setPreviewReloadTick((v) => v + 1);
      historyIndexRef.current = nextIndex;
      return nextIndex;
    });
  }, [history]);

  const focusedContainer = useMemo<RuntimeContainerState | null>(() => {
    if (!focusedContainerId) return displayContainers[0] ?? null;
    return displayContainers.find((c) => c.id === focusedContainerId) ?? displayContainers[0] ?? null;
  }, [displayContainers, focusedContainerId]);

  if (!user?.id) {
    return (
      <Layout>
        <DockerLoader message="Loading monitoring..." fullScreen={false} />
      </Layout>
    );
  }

  const runningCount = status?.running_count ?? 0;
  const exitedCount = status?.exited_count ?? 0;
  const unhealthyCount = status?.unhealthy_count ?? 0;
  const headerBadge = (() => {
    if (runtimeState === "stopping" || shuttingDown) {
      return { label: "Stopping", className: "border-slate-700 bg-slate-900 text-slate-400", icon: PlugZap };
    }
    if (runtimeState === "stopped_by_user") {
      return { label: "Stopped by user", className: "border-slate-700 bg-slate-900 text-slate-400", icon: PlugZap };
    }
    if (runtimeState === "running" && !shuttingDown) {
      return { label: "Running", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: PlugZap };
    }
    if (runtimeState === "unhealthy") {
      return { label: "Unhealthy", className: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: AlertTriangle };
    }
    if (runtimeState === "partial") {
      return { label: "Partial", className: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: AlertTriangle };
    }
    if (runtimeState === "exited" || runtimeState === "failed" || runtimeState === "cleanup_completed") {
      return { label: runtimeState === "failed" ? "Failed" : "Exited", className: "border-red-500/40 bg-red-500/10 text-red-300", icon: XCircle };
    }
    return { label: "No active runtime", className: "border-slate-700 bg-slate-900 text-slate-400", icon: PlugZap };
  })();
  const HeaderIcon = headerBadge.icon;
  const showRunningDot = runtimeState === "running" && !shuttingDown;

  return (
    <Layout>
      <MotionPage>
        <div className="w-full max-w-[1600px] mx-auto px-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(jobId ? `/execution?jobId=${jobId}` : "/history")}
                className="text-slate-400 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-400" /> Monitoring
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-xs">
                <Globe className="w-3 h-3" />
                DinD: <span className="font-mono">{dindIp ?? "unresolved"}</span>
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs ${headerBadge.className}`}
              >
                {showRunningDot && !reducedMotion ? (
                  <motion.span
                    className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"
                    animate={{ scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  />
                ) : (
                  <HeaderIcon className="w-3 h-3" />
                )}
                {headerBadge.label}
              </span>
            </div>
          </div>

          <RuntimeStatusBanner
            runtimeState={runtimeState}
            stoppedByUser={runtimeState === "stopped_by_user" || Boolean(status?.stopped_by_user)}
            exitReason={status?.exit_reason}
            onAcknowledge={() => navigate(jobId ? `/results?jobId=${jobId}` : "/history")}
          />

          {/* Runtime overview */}
          <Card className="p-3 bg-slate-900 border-slate-800 mb-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
              <span className="text-slate-400">
                Project: <span className="text-slate-200 font-mono">{status?.project_name ?? "-"}</span>
              </span>
              <span className="text-slate-400">
                Containers: <span className="text-slate-200 font-mono">{displayContainers.length}</span>
              </span>
              {shuttingDown ? (
                <span className="text-slate-400">shutting down (Docker may still report running briefly)</span>
              ) : (
                <>
                  <span className="text-emerald-300">running {runningCount}</span>
                  <span className="text-amber-300">unhealthy {unhealthyCount}</span>
                  <span className="text-red-300">exited {exitedCount}</span>
                </>
              )}
            </div>
            {displayContainers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {displayContainers.map((c) => {
                  const badge = containerStatusBadge(c, shuttingDown);
                  return (
                    <span
                      key={c.id}
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono ${badge.className}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClassName}`} />
                      {containerLabel(c)}: {badge.label}
                    </span>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3 items-start">
            <AppPreviewBrowser
              key={`${previewSrc}:${previewReloadTick}`}
              targets={previewTargets}
              selectedTargetUrl={selectedTargetUrl}
              onSelectTarget={handleSelectTarget}
              address={previewAddress}
              onAddressChange={setPreviewAddress}
              src={previewSrc}
              reloadTick={previewReloadTick}
              canGoBack={historyIndex > 0}
              canGoForward={historyIndex >= 0 && historyIndex < history.length - 1}
              onSubmit={handleAddressSubmit}
              onReload={handleReload}
              onBack={handleBack}
              onForward={handleForward}
            />

            <Card className="p-3 bg-slate-900 border-slate-800 flex flex-col">
              <h3 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-green-400" />
                Live Logs
              </h3>
              {displayContainers.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {displayContainers.map((c) => {
                    const isFocused = c.id === focusedContainer?.id;
                    const badge = containerStatusBadge(c, shuttingDown);
                    return (
                      <button
                        key={c.id}
                        onClick={() => setFocusedContainerId(c.id)}
                        className={`px-2 py-1 rounded border text-xs font-mono transition-colors flex items-center gap-1.5 ${
                          isFocused
                            ? "border-blue-500 bg-blue-500/20 text-blue-200"
                            : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClassName}`} />
                        {containerLabel(c)}
                      </button>
                    );
                  })}
                </div>
              )}
              {focusedContainer ? (
                <ContainerLogPanel
                  key={focusedContainer.id}
                  container={focusedContainer}
                  liveLines={logsByContainer[focusedContainer.id] ?? []}
                  connected={connectionByContainer[focusedContainer.id] ?? false}
                />
              ) : (
                <div className="flex flex-col h-[420px] rounded border border-slate-800 bg-slate-950 items-center justify-center">
                  <p className="text-xs text-slate-500">No containers to show logs for.</p>
                </div>
              )}
            </Card>
          </div>

          <div className="mb-3">
            <ContainerMetricsPanel
              container={focusedContainer}
              containerLabel={focusedContainer ? containerLabel(focusedContainer) : "-"}
              points={
                focusedContainer
                  ? metricsByContainer[focusedContainer.id]?.points ?? []
                  : []
              }
              latestPayload={
                focusedContainer
                  ? metricsByContainer[focusedContainer.id]?.latest ?? null
                  : null
              }
              connected={
                focusedContainer
                  ? metricsConnectedByContainer[focusedContainer.id] ?? false
                  : false
              }
              runtimeTerminal={TERMINAL_RUNTIME_STATES.has(runtimeState)}
              reducedMotion={reducedMotion ?? false}
              multiContainer={displayContainers.length > 1}
            />
          </div>
        </div>
      </MotionPage>
    </Layout>
  );
}
