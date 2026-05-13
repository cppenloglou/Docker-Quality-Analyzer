import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Container,
  Loader2,
  Play,
  ShieldAlert,
  Square,
  XCircle,
} from "lucide-react";

import { DockerLoader, useMinLoader } from "../components/DockerLoader";
import { Layout } from "../components/Layout";
import { MotionPage, StaggerList, StaggerItem } from "../components/motion";
import { TerminalLog, type TerminalLogEntry } from "../components/TerminalLog";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  ApiError,
  compose as composeApi,
  jobs as jobsApi,
  ws,
  type AnalysisResult,
  type DomainEvent,
  type Job,
  type RunnabilityMeta,
} from "../utils/api";
import { clearState, loadState, saveState } from "../utils/monitoringState";
import { pushNotification } from "../utils/notifications";

interface TimelineEntry {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

const BASE_TIMELINE: TimelineEntry[] = [
  { id: "enqueue", label: "Deploy job accepted", status: "pending" },
  { id: "start", label: "Container started", status: "pending" },
  { id: "metrics", label: "Metrics streaming", status: "pending" },
];
const EXECUTION_STATE_TTL_MS = 1000 * 60 * 60 * 6;

type DeployPhase = "idle" | "deploying" | "running" | "failed" | "exited";

interface ComposeUpProgress {
  total: number;
  created: number;
  started: number;
}

interface ExecutionPersistedState {
  containerIds: string[];
  deployJobId: string | null;
  timeline: TimelineEntry[];
  logs: TerminalLogEntry[];
  stackRunning: boolean;
  deployPhase?: DeployPhase;
}

const DEPLOY_TIMEOUT_MS = 120_000;

function ensureAnalysis(job: Job | null): AnalysisResult | null {
  if (!job?.result) return null;
  if (typeof job.result !== "object") return null;
  if (Array.isArray((job.result as AnalysisResult).errors)) {
    return job.result as AnalysisResult;
  }
  return null;
}

export function ContainerExecution() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryJobId = searchParams.get("jobId");
  const jobIdFromSession =
    typeof window !== "undefined"
      ? sessionStorage.getItem("analysisJobId")
      : null;
  const analysisJobId = queryJobId ?? jobIdFromSession ?? null;
  const stateKey = analysisJobId ? `dqa:execution:${analysisJobId}` : null;
  const persisted =
    stateKey != null
      ? loadState<ExecutionPersistedState>(stateKey, EXECUTION_STATE_TTL_MS)
      : null;

  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ready = useMinLoader(!loading);

  const [stopping, setStopping] = useState(false);
  const [stackRunning, setStackRunning] = useState(persisted?.stackRunning ?? false);
  const [deployPhase, setDeployPhase] = useState<DeployPhase>(
    persisted?.deployPhase ?? (persisted?.stackRunning ? "running" : "idle"),
  );
  const [deployJobId, setDeployJobId] = useState<string | null>(
    persisted?.deployJobId ?? null,
  );
  const [containerIds, setContainerIds] = useState<string[]>(
    persisted?.containerIds ?? [],
  );
  const [timeline, setTimeline] = useState<TimelineEntry[]>(
    persisted?.timeline && persisted.timeline.length > 0
      ? persisted.timeline
      : BASE_TIMELINE.map((entry) => ({ ...entry })),
  );
  const [logs, setLogs] = useState<TerminalLogEntry[]>(persisted?.logs ?? []);
  const [composeProgress, setComposeProgress] = useState<ComposeUpProgress | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const deployTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDeployTimeout = () => {
    if (deployTimeoutRef.current !== null) {
      clearTimeout(deployTimeoutRef.current);
      deployTimeoutRef.current = null;
    }
  };

  const analysis = useMemo(() => ensureAnalysis(job), [job]);
  const runnability: RunnabilityMeta | undefined = analysis?.meta?.runnability;
  const runnable = runnability?.runnable === true;

  const pushLog = (entry: TerminalLogEntry) =>
    setLogs((prev) => [...prev, entry]);

  const setTimelineStatus = (
    id: string,
    status: TimelineEntry["status"],
    detail?: string,
  ) =>
    setTimeline((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, status, detail } : entry)),
    );

  const closeSocket = () => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // noop
      }
      socketRef.current = null;
    }
  };

  useEffect(() => {
    if (!analysisJobId) {
      setLoadError("No analysis job available. Upload a compose file first.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const fetched = await jobsApi.get(analysisJobId);
        if (cancelled) return;
        setJob(fetched);
        if (fetched.type !== "compose" && fetched.type !== "project") {
          setLoadError(
            `Job ${fetched.id} is a ${fetched.type} job and cannot be deployed.`,
          );
          return;
        }

        const status = await composeApi.deployStatus(analysisJobId);
        if (status.active) {
          setStackRunning(true);
          setDeployPhase("running");
          setContainerIds(status.container_ids);
          if (!deployJobId) setDeployJobId(analysisJobId);
        } else {
          setStackRunning(false);
          setDeployPhase((prev) => (prev === "running" ? "idle" : prev));
          setContainerIds([]);
          setDeployJobId(null);
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load analysis job.";
        setLoadError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analysisJobId]);

  useEffect(() => {
    return () => {
      closeSocket();
      clearDeployTimeout();
    };
  }, []);

  useEffect(() => {
    if (!stateKey) return;
    saveState(stateKey, {
      containerIds,
      deployJobId,
      timeline,
      logs: logs.slice(-200),
      stackRunning,
      deployPhase,
    });
  }, [containerIds, deployJobId, timeline, logs, stateKey, stackRunning, deployPhase]);

  const handleDeploy = async () => {
    if (!job) return;
    if (!runnable && job.type === "compose") {
      toast.error("Compose stack is not runnable from a standalone file.");
      return;
    }
    setDeployPhase("deploying");
    clearDeployTimeout();
    setComposeProgress(null);
    setTimeline(BASE_TIMELINE.map((entry) => ({ ...entry })));
    setTimelineStatus("enqueue", "running", "Submitting deploy request...");
    try {
      const response = await composeApi.deploy({
        job_id: job.id,
        run_stack: true,
      });
      setDeployJobId(response.job_id);
      setTimelineStatus(
        "enqueue",
        "done",
        `Accepted as deploy ${response.job_id}`,
      );
      pushLog({
        message: `Deploy queued: ${response.job_id} (status ${response.status})`,
        tone: "success",
      });
      toast.success("Deploy request accepted");
      pushNotification("info", "Deploy Started", `Compose stack deploy queued for job ${job.id.slice(0, 8)}`);

      const socket = ws.connectJob(job.id);
      socketRef.current = socket;
      socket.onopen = () => {
        pushLog({
          message: `Streaming events for job ${job.id}`,
          tone: "info",
        });
      };
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as DomainEvent;
          if (
            parsed.event_name !== "deploy.compose_up_log" &&
            parsed.event_name !== "deploy.compose_up_progress"
          ) {
            pushLog({
              message: `${parsed.event_name} ${
                parsed.payload ? JSON.stringify(parsed.payload) : ""
              }`,
              timestamp: parsed.timestamp,
              tone:
                parsed.event_name === "user.analysis.failed"
                  ? "error"
                  : parsed.event_name === "container.metrics"
                    || parsed.event_name === "deploy.cleanup_started"
                    ? "info"
                    : "success",
            });
          }
          if (parsed.event_name === "deploy.compose_up_log") {
            const line = String((parsed.payload as { line?: string })?.line ?? "");
            if (line) {
              pushLog({ message: line, timestamp: parsed.timestamp, tone: "info" });
            }
            return;
          } else if (parsed.event_name === "deploy.compose_up_progress") {
            const p = parsed.payload as
              | { total_services?: number; created?: number; started?: number }
              | undefined;
            const total = Number(p?.total_services ?? 0);
            const created = Number(p?.created ?? 0);
            const started = Number(p?.started ?? 0);
            if (total > 0) {
              setComposeProgress({ total, created, started });
            }
            return;
          }

          if (parsed.event_name === "container.started") {
            const ids = (parsed.payload as { container_ids?: string[] })?.container_ids ?? [];
            const primaryId = String(
              (parsed.payload as { container_id?: string })?.container_id ?? "",
            );
            setContainerIds(ids.length > 0 ? ids : primaryId ? [primaryId] : []);
            setStackRunning(true);
            setDeployPhase("running");
            clearDeployTimeout();
            setTimelineStatus(
              "start",
              "done",
              ids.length > 0 ? `${ids.length} container(s) started` : "Container started",
            );
            pushNotification("success", "Containers Running", `${ids.length || 1} container(s) are now running`);
          } else if (parsed.event_name === "container.metrics") {
            setTimelineStatus("metrics", "running", "Metrics streaming");
          } else if (parsed.event_name === "container.exited") {
            const p = parsed.payload as { container_id?: string; container_name?: string; exit_code?: number; error?: string };
            const name = p.container_name ?? p.container_id?.slice(0, 12) ?? "container";
            const exitMsg = `Container exited: ${name} (code ${p.exit_code ?? "??"})${p.error ? ` — ${p.error}` : ""}`;
            setTimelineStatus("start", "error", exitMsg);
            pushLog({ message: exitMsg, timestamp: parsed.timestamp, tone: "error" });
          } else if (parsed.event_name === "project.runtime_stopped") {
            setTimelineStatus("metrics", "done", "All containers exited");
            setStackRunning(false);
            setDeployPhase("exited");
            clearDeployTimeout();
            pushLog({ message: "All containers have exited.", timestamp: parsed.timestamp, tone: "info" });
            pushNotification("warning", "Runtime Stopped", "All containers have exited");
          } else if (parsed.event_name === "container.stopped") {
            setTimelineStatus("metrics", "done", "Stack stopped");
            setStackRunning(false);
            setDeployPhase("idle");
            clearDeployTimeout();
            setContainerIds([]);
            setDeployJobId(null);
            if (stateKey) clearState(stateKey);
            toast.success("Compose stack stopped");
            pushNotification("warning", "Containers Stopped", "All containers have been stopped");
          } else if (parsed.event_name === "deploy.cleanup_started") {
            const projectName = String(
              (parsed.payload as { project_name?: string })?.project_name ?? "compose stack",
            );
            setStackRunning(false);
            setContainerIds([]);
            pushLog({
              message: `Cleanup started for ${projectName}`,
              timestamp: parsed.timestamp,
              tone: "info",
            });
            toast.message("Stopping and removing stack resources...");
            pushNotification("info", "Cleanup Started", "Removing containers created by the failed deploy");
          } else if (parsed.event_name === "deploy.cleanup_completed") {
            const projectName = String(
              (parsed.payload as { project_name?: string })?.project_name ?? "compose stack",
            );
            setStackRunning(false);
            setContainerIds([]);
            setDeployJobId(null);
            if (stateKey) clearState(stateKey);
            pushLog({
              message: `Cleanup completed for ${projectName}`,
              timestamp: parsed.timestamp,
              tone: "success",
            });
            toast.success("Failed deploy containers stopped and removed");
            pushNotification("success", "Cleanup Completed", "Failed deploy containers were removed from the sandbox");
          } else if (parsed.event_name === "user.analysis.failed") {
            setTimelineStatus(
              "start",
              "error",
              String(
                (parsed.payload as { message?: string })?.message ?? "failed",
              ),
            );
            setStackRunning(false);
            setDeployPhase("failed");
            clearDeployTimeout();
            toast.error("Deploy workflow reported a failure");
          }
        } catch {
          pushLog({ message: String(event.data), tone: "info" });
        }
      };
      socket.onerror = () =>
        pushLog({ message: "Event stream error", tone: "error" });
      socket.onclose = () =>
        pushLog({ message: "Event stream closed", tone: "warning" });

      deployTimeoutRef.current = setTimeout(() => {
        setDeployPhase((current) => {
          if (current !== "deploying") return current;
          pushLog({
            message: "No deploy lifecycle event received within 2 minutes - marking as failed.",
            tone: "error",
          });
          setTimelineStatus("start", "error", "Deploy timed out waiting for events");
          toast.error("Deploy timed out waiting for events");
          return "failed";
        });
        deployTimeoutRef.current = null;
      }, DEPLOY_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof ApiError) {
        setTimelineStatus("enqueue", "error", err.message);
        if (err.status === 409 && err.reasons && err.reasons.length) {
          toast.error(`Deploy blocked: ${err.message}`);
          pushLog({
            message: `Blocked reasons:\n${err.reasons.map((r) => `  - ${r}`).join("\n")}`,
            tone: "error",
          });
        } else {
          toast.error(err.message);
        }
      } else {
        const message = err instanceof Error ? err.message : "Deploy failed";
        toast.error(message);
        setTimelineStatus("enqueue", "error", message);
      }
      setDeployPhase("failed");
      clearDeployTimeout();
    }
  };

  const handleStop = async () => {
    if (!job || stopping) return;
    setStopping(true);
    setStackRunning(false);
    setContainerIds([]);
    sessionStorage.setItem("dqa:containerStatus", "stopping");
    pushLog({ message: `Stop requested for deploy ${job.id}`, tone: "warning" });
    try {
      const response = await composeApi.stopDeploy({ job_id: job.id });
      pushLog({
        message: `Stop queued: ${response.job_id} (status ${response.status})`,
        tone: "success",
      });
      setTimelineStatus("metrics", "done", "Stop signal sent");
      toast.success("Stop request accepted");
      pushNotification("info", "Stopping Containers", "Stop signal sent, waiting for containers to shut down...");

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const status = await composeApi.deployStatus(job.id);
          if (!status.active) {
            setDeployJobId(null);
            if (stateKey) clearState(stateKey);
            sessionStorage.removeItem("dqa:containerStatus");
            pushLog({ message: "Stack confirmed stopped", tone: "success" });
            pushNotification("success", "Containers Stopped", "All containers have been successfully stopped");
            break;
          }
        } catch {
          break;
        }
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to stop deployment";
      pushLog({ message, tone: "error" });
      toast.error(message);
      setStackRunning(true);
    } finally {
      setStopping(false);
    }
  };

  if (!ready) {
    return (
      <Layout>
        <DockerLoader message="Loading deployment context..." fullScreen={false} />
      </Layout>
    );
  }

  if (loadError && !job) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => navigate("/history")}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to History
          </Button>
          <Card className="p-6 bg-red-950/20 border-red-800 text-red-300">
            <p className="mb-4">{loadError}</p>
            <Button onClick={() => navigate("/")}>Back to Home</Button>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <MotionPage>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate(`/results?jobId=${job?.id ?? ""}`)}
            className="text-slate-400 hover:text-white mb-2"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Results
          </Button>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-white">
                Deploy Compose Stack
              </h1>
              {job && (
                <p className="text-xs text-slate-500 mt-1">
                  Job: {job.id} ({job.type})
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleDeploy}
                disabled={
                  !job ||
                  deployPhase === "deploying" ||
                  deployPhase === "running" ||
                  stopping ||
                  (job.type === "compose" && !runnable)
                }
                className="bg-green-600 hover:bg-green-700"
                title={
                  deployPhase === "running"
                    ? "Stack is already running. Stop it first."
                    : deployPhase === "deploying"
                      ? "Deploy in progress..."
                      : deployPhase === "failed"
                        ? "Previous deploy failed. Click to retry."
                        : deployPhase === "exited"
                          ? "All containers exited. Click to run again."
                          : "Trigger deploy"
                }
              >
                {deployPhase === "deploying" || stopping ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : deployPhase === "exited" ? (
                  <XCircle className="w-4 h-4 mr-2 text-amber-300" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                {stopping
                  ? "Stopping..."
                  : deployPhase === "running"
                    ? "Running"
                    : deployPhase === "deploying"
                      ? "Deploying..."
                      : deployPhase === "exited"
                        ? "Exited — Run Again"
                        : "Deploy"}
              </Button>
              <Button
                onClick={handleStop}
                disabled={!stackRunning || stopping}
                variant="outline"
                className="border-red-700 text-red-300 hover:bg-red-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {stopping ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Square className="w-4 h-4 mr-2" />
                )}
                Stop
              </Button>
              <Button
                onClick={() => navigate(`/monitoring/${job?.id}`)}
                disabled={!stackRunning || stopping}
                variant="outline"
                className="border-blue-600 text-blue-400 hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Activity className="w-4 h-4 mr-2" />
                Monitor
              </Button>
            </div>
          </div>
        </div>

        <Card className="p-4 bg-slate-900 border-slate-800 mb-4">
          <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
            <Container className="w-4 h-4 text-blue-400" /> Timeline
          </h2>
          <StaggerList className="space-y-1">
            {timeline.map((entry) => (
              <StaggerItem key={entry.id}>
                {entry.id === "start" &&
                  (deployPhase === "deploying" || (composeProgress && composeProgress.started < composeProgress.total)) && (
                    <div className="px-2 py-2 mb-1 rounded border border-slate-800 bg-slate-950">
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                        <span>docker-compose up progress</span>
                        {composeProgress ? (
                          <span className="font-mono">
                            {composeProgress.created}/{composeProgress.total} created,{" "}
                            {composeProgress.started}/{composeProgress.total} running
                          </span>
                        ) : (
                          <span className="text-slate-500 italic">waiting for output...</span>
                        )}
                      </div>
                      <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
                        {composeProgress && composeProgress.total > 0 ? (
                          <div
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{
                              width: `${Math.min(100, Math.round((composeProgress.started / composeProgress.total) * 100))}%`,
                            }}
                          />
                        ) : (
                          <div className="h-full w-1/3 bg-blue-500/60 animate-pulse" />
                        )}
                      </div>
                    </div>
                  )}
              <div
                className="flex items-center gap-2 px-2 py-1.5 rounded border border-slate-800 bg-slate-950"
              >
                <div className="flex-shrink-0">
                  {entry.status === "done" && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                  {entry.status === "running" && (
                    <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                  )}
                  {entry.status === "pending" && (
                    <Container className="w-4 h-4 text-slate-600" />
                  )}
                  {entry.status === "error" && (
                    <ShieldAlert className="w-4 h-4 text-red-400" />
                  )}
                </div>
                <span
                  className={`text-xs font-medium ${
                    entry.status === "done"
                      ? "text-emerald-300"
                      : entry.status === "running"
                        ? "text-blue-300"
                        : entry.status === "error"
                          ? "text-red-300"
                          : "text-slate-400"
                  }`}
                >
                  {entry.label}
                </span>
                {entry.detail && (
                  <span className="text-xs text-slate-500 truncate">
                    — {entry.detail}
                  </span>
                )}
                {entry.id === "start" && containerIds.length > 0 && (
                  <Badge className="ml-auto bg-blue-500/20 text-blue-300 border-blue-500/30 font-mono text-xs">
                    {containerIds.length}
                  </Badge>
                )}
              </div>
              </StaggerItem>
            ))}
          </StaggerList>
        </Card>

        <TerminalLog
          logs={logs}
          title="Deploy event stream"
          emptyLabel="Deploy has not started yet."
          maxHeight="360px"
        />
      </div>
      </MotionPage>
    </Layout>
  );
}
