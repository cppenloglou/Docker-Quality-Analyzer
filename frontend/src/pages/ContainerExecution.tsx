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

interface ExitedContainerSummary {
  container_id?: string;
  container_name?: string;
  exit_code?: number | null;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  restart_count?: number | null;
  oom_killed?: boolean | null;
  last_logs?: string[] | null;
  stop_requested_by_user?: boolean;
}

interface ProblematicAlertState {
  open: boolean;
  message: string;
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
  const [problematicAlert, setProblematicAlert] = useState<ProblematicAlertState>({
    open: false,
    message: "",
  });
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
  const [exitedContainers, setExitedContainers] = useState<ExitedContainerSummary[]>([]);
  const [metricsSeenContainerIds, setMetricsSeenContainerIds] = useState<string[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const deployTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const stoppingRef = useRef(stopping);
  const cleanupAttemptedRef = useRef(false);

  useEffect(() => {
    stoppingRef.current = stopping;
  }, [stopping]);

  const clearDeployTimeout = () => {
    if (deployTimeoutRef.current !== null) {
      clearTimeout(deployTimeoutRef.current);
      deployTimeoutRef.current = null;
    }
  };

  const analysis = useMemo(() => ensureAnalysis(job), [job]);
  const runnability: RunnabilityMeta | undefined = analysis?.meta?.runnability;
  const runnable = runnability?.runnable === true;
  const deployComposeFile = useMemo(() => {
    if (!job) return null;
    const metadata = job.input_metadata ?? {};
    const explicitPrimary = metadata.primary_compose_file;
    if (typeof explicitPrimary === "string" && explicitPrimary.trim()) {
      return explicitPrimary;
    }
    const selectedCompose = metadata.selected_compose_files;
    if (
      Array.isArray(selectedCompose) &&
      selectedCompose.length > 0 &&
      typeof selectedCompose[0] === "string"
    ) {
      return selectedCompose[0];
    }
    const composeFiles = metadata.compose_files;
    if (
      Array.isArray(composeFiles) &&
      composeFiles.length > 0 &&
      typeof composeFiles[0] === "string"
    ) {
      return composeFiles[0];
    }
    const filename = metadata.filename;
    return typeof filename === "string" && filename.trim() ? filename : null;
  }, [job]);
  const resubmitRequired =
    !!analysisJobId &&
    sessionStorage.getItem(`dqa:resubmitRequired:${analysisJobId}`) === "1";

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

  const resetExecutionViewState = () => {
    setTimeline(BASE_TIMELINE.map((entry) => ({ ...entry })));
    setComposeProgress(null);
    setExitedContainers([]);
    setMetricsSeenContainerIds([]);
  };

  const setResubmitRequired = () => {
    if (!analysisJobId) return;
    sessionStorage.setItem(`dqa:resubmitRequired:${analysisJobId}`, "1");
  };

  const markProblematicStack = (
    message: string,
    options?: { cleanupRuntime?: boolean; keepExitData?: boolean },
  ) => {
    setResubmitRequired();
    setProblematicAlert({ open: true, message });
    setStackRunning(false);
    setStopping(false);
    setDeployPhase("failed");
    clearDeployTimeout();
    sessionStorage.removeItem("dqa:containerStatus");
    if (!options?.keepExitData) {
      resetExecutionViewState();
    }
    if (stateKey) clearState(stateKey);

    if (
      options?.cleanupRuntime &&
      !cleanupAttemptedRef.current &&
      job &&
      !unmountedRef.current
    ) {
      cleanupAttemptedRef.current = true;
      void composeApi
        .stopDeploy({ job_id: job.id, remove_volumes: true })
        .then(() => {
          pushLog({
            message: "Cleanup requested for problematic stack (volumes included).",
            tone: "warning",
          });
        })
        .catch((err) => {
          const msg = err instanceof ApiError ? err.message : "Cleanup request failed";
          pushLog({ message: msg, tone: "error" });
        });
    }
  };

  const handleDomainEvent = (parsed: DomainEvent) => {
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
      setStopping(false);
      setComposeProgress(null);
      setDeployPhase("running");
      clearDeployTimeout();
      setTimelineStatus(
        "start",
        "done",
        ids.length > 0 ? `${ids.length} container(s) started` : "Container started",
      );
      pushNotification("success", "Containers Running", `${ids.length || 1} container(s) are now running`);
    } else if (parsed.event_name === "container.metrics") {
      const metricContainerId = String(
        (parsed.payload as { container_id?: string })?.container_id ?? "",
      );
      if (metricContainerId) {
        setMetricsSeenContainerIds((prev) =>
          prev.includes(metricContainerId) ? prev : [...prev, metricContainerId],
        );
      }
      // Mark as done to avoid a perpetual "loading" spinner while runtime is healthy.
      setTimelineStatus("metrics", "done", "Metrics streaming");
    } else if (parsed.event_name === "container.exited") {
      const p = parsed.payload as ExitedContainerSummary;
      const stopRequestedByUser = p.stop_requested_by_user === true || stoppingRef.current;
      if (stopRequestedByUser) {
        const name = p.container_name ?? p.container_id?.slice(0, 12) ?? "container";
        pushLog({
          message: `Container stopped during user-requested shutdown: ${name}`,
          timestamp: parsed.timestamp,
          tone: "info",
        });
        return;
      }
      const name = p.container_name ?? p.container_id?.slice(0, 12) ?? "container";
      const exitMsg = `Container exited: ${name} (code ${p.exit_code ?? "??"})${p.error ? ` — ${p.error}` : ""}`;
      setTimelineStatus("start", "error", exitMsg);
      pushLog({ message: exitMsg, timestamp: parsed.timestamp, tone: "error" });
      setExitedContainers((prev) => {
        const key = p.container_id ?? `${p.container_name ?? "container"}-${p.finished_at ?? ""}`;
        const next = prev.filter((item) => {
          const itemKey = item.container_id ?? `${item.container_name ?? "container"}-${item.finished_at ?? ""}`;
          return itemKey !== key;
        });
        return [...next, p];
      });
      markProblematicStack(
        "Current stack is problematic. Please fix the stack and resubmit before deploying again.",
        { cleanupRuntime: true, keepExitData: true },
      );
    } else if (parsed.event_name === "project.runtime_stopped") {
      if (stoppingRef.current) {
        setTimelineStatus("metrics", "done", "Stop completed");
        setStackRunning(false);
        setStopping(false);
        setDeployPhase("idle");
        clearDeployTimeout();
        resetExecutionViewState();
        return;
      }
      setTimelineStatus("metrics", "error", "All containers exited unexpectedly");
      pushLog({ message: "All containers have exited.", timestamp: parsed.timestamp, tone: "error" });
      pushNotification("warning", "Runtime Stopped", "All containers have exited");
      markProblematicStack(
        "Current stack is problematic. Please fix the stack and resubmit before deploying again.",
        { cleanupRuntime: true, keepExitData: true },
      );
    } else if (parsed.event_name === "container.stopped") {
      setTimelineStatus("metrics", "done", "Stack stopped");
      setStackRunning(false);
      setStopping(false);
      setDeployPhase("idle");
      clearDeployTimeout();
      setContainerIds([]);
      setDeployJobId(null);
      sessionStorage.removeItem("dqa:containerStatus");
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
      setStopping(false);
      setContainerIds([]);
      setDeployJobId(null);
      sessionStorage.removeItem("dqa:containerStatus");
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
      setStopping(false);
      setDeployPhase("failed");
      clearDeployTimeout();
      toast.error("Deploy workflow reported a failure");
    }
  };

  const connectJobSocket = (streamJobId: string, announce = false) => {
    closeSocket();
    const socket = ws.connectJob(streamJobId);
    socketRef.current = socket;
    socket.onopen = () => {
      if (announce) {
        pushLog({
          message: `Streaming events for job ${streamJobId}`,
          tone: "info",
        });
      }
    };
    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as DomainEvent;
        handleDomainEvent(parsed);
      } catch {
        pushLog({ message: String(event.data), tone: "info" });
      }
    };
    socket.onerror = () =>
      pushLog({ message: "Event stream error", tone: "error" });
    socket.onclose = () =>
      pushLog({ message: "Event stream closed", tone: "warning" });
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
        const rs = status.runtime_state ?? "none";
        const problematicByRuntimeState =
          rs === "failed" ||
          rs === "cleanup_completed" ||
          rs === "exited" ||
          rs === "partial" ||
          rs === "unhealthy";
        const resubmitRequired =
          sessionStorage.getItem(`dqa:resubmitRequired:${analysisJobId}`) === "1";
        if (status.active) {
          if (rs === "partial" || rs === "unhealthy") {
            markProblematicStack(
              "Current stack is problematic. Please fix the stack and resubmit before deploying again.",
              { cleanupRuntime: true, keepExitData: true },
            );
            return;
          }
          setStackRunning(true);
          if (rs === "stopping") {
            setStopping(true);
            setDeployPhase("idle");
          } else {
            setStopping(false);
            setDeployPhase("running");
            connectJobSocket(analysisJobId);
          }
          setContainerIds(status.container_ids);
          if (!deployJobId) setDeployJobId(analysisJobId);
        } else if (problematicByRuntimeState || resubmitRequired) {
          if (!resubmitRequired && (status.stopped_by_user || status.stop_reason === "user_requested")) {
            setStackRunning(false);
            setStopping(false);
            setDeployPhase("idle");
            setContainerIds([]);
            setDeployJobId(null);
            resetExecutionViewState();
            if (stateKey) clearState(stateKey);
            sessionStorage.removeItem("dqa:containerStatus");
            return;
          }
          setStackRunning(false);
          setStopping(false);
          setDeployPhase("exited");
          setContainerIds(status.container_ids);
          // Populate exited container summaries from persisted container info
          if (status.containers && status.containers.length > 0) {
            setExitedContainers(
              status.containers
                .filter((c) => c.status === "exited" || c.exit_code != null)
                .map((c) => ({
                  container_id: c.id,
                  container_name: c.name ?? undefined,
                  exit_code: c.exit_code ?? undefined,
                  error: c.error ?? undefined,
                  started_at: c.started_at ?? undefined,
                  finished_at: c.finished_at ?? undefined,
                  restart_count: c.restart_count ?? undefined,
                  oom_killed: c.oom_killed ?? undefined,
                  last_logs: c.last_logs ?? undefined,
                })),
            );
          }
          markProblematicStack(
            "Current stack is problematic. Please fix the stack and resubmit before deploying again.",
            { cleanupRuntime: true, keepExitData: true },
          );
        } else if (rs === "stopped_by_user") {
          setStackRunning(false);
          setStopping(false);
          setDeployPhase("idle");
          setContainerIds([]);
          setDeployJobId(null);
          resetExecutionViewState();
          if (stateKey) clearState(stateKey);
          sessionStorage.removeItem("dqa:containerStatus");
        } else {
          setStackRunning(false);
          setStopping(false);
          setDeployPhase((prev) => (prev === "running" ? "idle" : prev));
          setContainerIds([]);
          setDeployJobId(null);
          resetExecutionViewState();
          if (stateKey) clearState(stateKey);
          sessionStorage.removeItem("dqa:containerStatus");
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
    // This effect intentionally rehydrates only when the target analysis job changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisJobId]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
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
    if (resubmitRequired) {
      toast.error("This stack is marked problematic. Please fix and resubmit.");
      return;
    }
    if (!runnable && job.type === "compose") {
      toast.error("Compose stack is not runnable from a standalone file.");
      return;
    }
    setDeployPhase("deploying");
    setStopping(false);
    clearDeployTimeout();
    setComposeProgress(null);
    setExitedContainers([]);
    setMetricsSeenContainerIds([]);
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

      connectJobSocket(job.id, true);

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
    const previousContainerIds = containerIds;
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
        if (unmountedRef.current) break;
        await new Promise((r) => setTimeout(r, 2000));
        if (unmountedRef.current) break;
        try {
          const status = await composeApi.deployStatus(job.id);
          if (!status.active) {
            if (unmountedRef.current) break;
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
      if (!unmountedRef.current) {
        setStackRunning(true);
        setContainerIds(previousContainerIds);
      }
    } finally {
      if (!unmountedRef.current) {
        setStopping(false);
      }
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
                <>
                  <p className="text-xs text-slate-500 mt-1">
                    Job: {job.id} ({job.type})
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Compose used for deploy:{" "}
                    <span className="text-slate-300 font-mono">
                      {deployComposeFile ?? "-"}
                    </span>
                  </p>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleDeploy}
                disabled={
                  !job ||
                  resubmitRequired ||
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
                      : resubmitRequired
                        ? "Problematic stack: fix and resubmit from Results."
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
                  : resubmitRequired
                    ? "Resubmit Required"
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

        {problematicAlert.open && (
          <Card className="p-5 bg-red-950/30 border-red-800 mb-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h2 className="text-base font-semibold text-red-300 mb-1">
                  Problematic Stack Detected
                </h2>
                <p className="text-sm text-red-200/80">
                  {problematicAlert.message}
                </p>
                <p className="text-xs text-red-200/60 mt-2">
                  You need to fix the stack and resubmit. Analysis results remain available.
                </p>
              </div>
              <Button
                onClick={() => navigate(`/results?jobId=${job?.id ?? analysisJobId ?? ""}`)}
                className="bg-red-700 hover:bg-red-800"
              >
                I Understand
              </Button>
            </div>
          </Card>
        )}

        <Card className="p-4 bg-slate-900 border-slate-800 mb-4">
          <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
            <Container className="w-4 h-4 text-blue-400" /> Timeline
          </h2>
          <StaggerList className="space-y-1">
            {timeline.map((entry) => (
              <StaggerItem key={entry.id}>
                {entry.id === "start" &&
                  deployPhase === "deploying" && (
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

        {deployPhase === "exited" && exitedContainers.length > 0 && (
          <Card className="p-4 bg-red-950/20 border-red-800/50 mb-4">
            <h3 className="text-sm font-semibold text-red-300 mb-3">Container Exit Summary</h3>
            <div className="space-y-3">
              {exitedContainers.map((containerExit, index) => {
                const containerKey =
                  containerExit.container_id ??
                  `${containerExit.container_name ?? "container"}-${containerExit.finished_at ?? index}`;
                const name =
                  containerExit.container_name ??
                  containerExit.container_id?.slice(0, 12) ??
                  `container-${index + 1}`;
                const hasMetrics =
                  !!containerExit.container_id &&
                  metricsSeenContainerIds.includes(containerExit.container_id);
                return (
                  <div key={containerKey} className="rounded border border-red-800/40 bg-slate-950 p-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-sm font-semibold text-red-200">{name}</span>
                      {containerExit.exit_code != null && (
                        <Badge className="bg-red-900/40 text-red-200 border-red-700/50 font-mono text-xs">
                          exit code: {containerExit.exit_code}
                        </Badge>
                      )}
                      {containerExit.oom_killed && (
                        <Badge className="bg-orange-900/40 text-orange-300 border-orange-700/50 text-xs">
                          OOM killed
                        </Badge>
                      )}
                    </div>
                    {containerExit.error && (
                      <p className="text-xs text-red-300 font-mono mb-1.5">{containerExit.error}</p>
                    )}
                    <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                      {containerExit.started_at && (
                        <span>Started: {new Date(containerExit.started_at).toLocaleString()}</span>
                      )}
                      {containerExit.finished_at && (
                        <span>Finished: {new Date(containerExit.finished_at).toLocaleString()}</span>
                      )}
                      {containerExit.restart_count != null && (
                        <span>Restarts: {containerExit.restart_count}</span>
                      )}
                    </div>
                    {!hasMetrics && (
                      <p className="text-xs text-slate-500 mt-1 italic">
                        Container exited before metrics were collected.
                      </p>
                    )}
                    {Array.isArray(containerExit.last_logs) && containerExit.last_logs.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-slate-400 cursor-pointer select-none">
                          Last logs ({containerExit.last_logs.length} lines)
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded border border-slate-800 bg-black/20 p-2 text-[10px] text-slate-300 whitespace-pre-wrap font-mono">
                          {containerExit.last_logs.join("\n")}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

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
