import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Container,
  ExternalLink,
  Loader2,
  Play,
  PackageSearch,
  Rocket,
  ShieldAlert,
  Square,
  Upload,
} from "lucide-react";

import { Layout } from "../components/Layout";
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

interface TimelineEntry {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

const BASE_TIMELINE: TimelineEntry[] = [
  { id: "precheck", label: "Runnability precheck", status: "running" },
  { id: "enqueue", label: "Deploy job accepted", status: "pending" },
  { id: "push", label: "Images pushed / available", status: "pending" },
  { id: "start", label: "Container started", status: "pending" },
  { id: "metrics", label: "Metrics streaming", status: "pending" },
];
const EXECUTION_STATE_TTL_MS = 1000 * 60 * 60 * 6;

interface ExecutionPersistedState {
  containerId: string | null;
  deployJobId: string | null;
  timeline: TimelineEntry[];
  logs: TerminalLogEntry[];
}

function ensureAnalysis(
  job: Job | null,
): AnalysisResult | null {
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

  const [pushPublicImages, setPushPublicImages] = useState(false);
  const [runStack, setRunStack] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [deployJobId, setDeployJobId] = useState<string | null>(
    persisted?.deployJobId ?? null,
  );
  const [containerId, setContainerId] = useState<string | null>(
    persisted?.containerId ?? null,
  );
  const [timeline, setTimeline] = useState<TimelineEntry[]>(
    persisted?.timeline && persisted.timeline.length > 0
      ? persisted.timeline
      : BASE_TIMELINE.map((entry) => ({ ...entry })),
  );
  const [logs, setLogs] = useState<TerminalLogEntry[]>(persisted?.logs ?? []);
  const socketRef = useRef<WebSocket | null>(null);

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
          setTimelineStatus("precheck", "error", "Not a deployable job");
          return;
        }
        const ok =
          ensureAnalysis(fetched)?.meta?.runnability?.runnable === true;
        setTimelineStatus(
          "precheck",
          ok ? "done" : "error",
          ok
            ? "Compose stack passes runnability rules"
            : "Compose stack blocked by runnability rules",
        );
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load analysis job.";
        setLoadError(message);
        setTimelineStatus("precheck", "error", message);
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
    };
  }, []);

  useEffect(() => {
    if (!stateKey) return;
    saveState(stateKey, {
      containerId,
      deployJobId,
      timeline,
      logs: logs.slice(-200),
    });
  }, [containerId, deployJobId, timeline, logs, stateKey]);

  const handleDeploy = async () => {
    if (!job) return;
    if (!runnable && job.type === "compose") {
      toast.error("Compose stack is not runnable from a standalone file.");
      return;
    }
    setDeploying(true);
    setTimelineStatus("enqueue", "running", "Submitting deploy request...");
    try {
      const response = await composeApi.deploy({
        job_id: job.id,
        push_public_images: pushPublicImages,
        run_stack: runStack,
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
          pushLog({
            message: `${parsed.event_name} ${
              parsed.payload ? JSON.stringify(parsed.payload) : ""
            }`,
            timestamp: parsed.timestamp,
            tone:
              parsed.event_name === "user.analysis.failed"
                ? "error"
                : parsed.event_name === "container.metrics"
                  ? "info"
                  : "success",
          });
          if (parsed.event_name === "docker.image.pushed") {
            setTimelineStatus(
              "push",
              "done",
              String(
                (parsed.payload as { registry_ref?: string })?.registry_ref ??
                  "image pushed",
              ),
            );
          } else if (parsed.event_name === "container.started") {
            const cid = String(
              (parsed.payload as { container_id?: string })?.container_id ??
                "",
            );
            setContainerId(cid || null);
            setTimelineStatus(
              "start",
              "done",
              cid ? `Container ${cid}` : "Container started",
            );
          } else if (parsed.event_name === "container.metrics") {
            setTimelineStatus("metrics", "running", "Metrics streaming");
          } else if (parsed.event_name === "container.stopped") {
            setTimelineStatus("metrics", "done", "Stack stopped");
            setContainerId(null);
            setDeployJobId(null);
            if (stateKey) clearState(stateKey);
            toast.success("Compose stack stopped");
          } else if (parsed.event_name === "user.analysis.failed") {
            setTimelineStatus(
              "start",
              "error",
              String(
                (parsed.payload as { message?: string })?.message ?? "failed",
              ),
            );
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
    } finally {
      setDeploying(false);
    }
  };

  const handleStop = async () => {
    if (!job || stopping) return;
    setStopping(true);
    pushLog({ message: `Stop requested for deploy ${job.id}`, tone: "warning" });
    try {
      const response = await composeApi.stopDeploy({ job_id: job.id });
      pushLog({
        message: `Stop queued: ${response.job_id} (status ${response.status})`,
        tone: "success",
      });
      setTimelineStatus("metrics", "done", "Stop signal sent");
      toast.success("Stop request accepted");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to stop deployment";
      pushLog({ message, tone: "error" });
      toast.error(message);
    } finally {
      setStopping(false);
    }
  };

  const goMonitoring = () => {
    if (job && containerId) {
      navigate(`/monitoring/${job.id}/${containerId}`);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto py-16 flex flex-col items-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400 mb-4" />
          <p>Loading deployment context...</p>
        </div>
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

  const yamlSnapshot =
    (job?.input_metadata?.content as string | undefined) ??
    (job?.input_metadata?.filename as string | undefined);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate(`/results?jobId=${job?.id ?? ""}`)}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Results
          </Button>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">
                Deploy Compose Stack
              </h1>
              <p className="text-slate-400">
                Trigger the backend deploy workflow and watch live events.
              </p>
              {job && (
                <p className="text-xs text-slate-500 mt-1">
                  Analysis job: {job.id} ({job.type})
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button
                onClick={handleDeploy}
                disabled={
                  !job ||
                  deploying ||
                  (job.type === "compose" && !runnable) ||
                  !!deployJobId
                }
                className="bg-green-600 hover:bg-green-700"
                title={
                  !runnable && job?.type === "compose"
                    ? "Compose stack is not runnable. Upload the full project instead."
                    : "Trigger deploy"
                }
              >
                {deploying ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                {deployJobId ? "Deploy in flight" : "Deploy now"}
              </Button>
              {deployJobId && (
                <Button
                  onClick={handleStop}
                  disabled={stopping}
                  variant="outline"
                  className="border-red-700 text-red-300 hover:bg-red-600/20"
                >
                  {stopping ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Square className="w-4 h-4 mr-2" />
                  )}
                  Stop stack
                </Button>
              )}
              {containerId && (
                <Button
                  onClick={goMonitoring}
                  variant="outline"
                  className="border-blue-600 text-blue-400 hover:bg-blue-500/10"
                >
                  <Activity className="w-4 h-4 mr-2" />
                  Watch metrics
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mb-6">
          <Card className="p-5 bg-slate-900 border-slate-800 md:col-span-2">
            <h2 className="text-lg font-semibold text-white mb-3">
              Deploy options
            </h2>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 accent-blue-500"
                  checked={pushPublicImages}
                  onChange={(e) => setPushPublicImages(e.target.checked)}
                />
                <div>
                  <div className="text-slate-200 text-sm font-medium flex items-center gap-2">
                    <Upload className="w-4 h-4" /> Push public images
                  </div>
                  <p className="text-xs text-slate-400">
                    Publish images referenced by the compose stack to the
                    configured registry.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 accent-blue-500"
                  checked={runStack}
                  onChange={(e) => setRunStack(e.target.checked)}
                />
                <div>
                  <div className="text-slate-200 text-sm font-medium flex items-center gap-2">
                    <Rocket className="w-4 h-4" /> Run stack
                  </div>
                  <p className="text-xs text-slate-400">
                    Bring up the compose stack and stream container metrics.
                  </p>
                </div>
              </label>
            </div>
          </Card>

          <Card className="p-5 bg-slate-900 border-slate-800">
            <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" /> Runnability
            </h2>
            {job?.type === "project" ? (
              <p className="text-sm text-slate-300">
                Project deploys skip the standalone runnability gate.
              </p>
            ) : runnable ? (
              <p className="text-sm text-emerald-300">
                Compose stack passes all runnability rules.
              </p>
            ) : (
              <>
                <p className="text-sm text-amber-300 mb-2">
                  Deploy is blocked until these rules pass:
                </p>
                <ul className="list-disc list-inside text-sm text-slate-300 space-y-1">
                  {(runnability?.reasons ?? ["No runnability metadata."]).map(
                    (reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ),
                  )}
                </ul>
              </>
            )}
          </Card>
        </div>

        <Card className="p-5 bg-slate-900 border-slate-800 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Container className="w-5 h-5 text-blue-400" /> Deploy timeline
          </h2>
          <div className="space-y-2">
            {timeline.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 p-3 rounded border border-slate-800 bg-slate-950"
              >
                <div className="pt-0.5">
                  {entry.status === "done" && (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  )}
                  {entry.status === "running" && (
                    <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                  )}
                  {entry.status === "pending" && (
                    <Container className="w-5 h-5 text-slate-600" />
                  )}
                  {entry.status === "error" && (
                    <ShieldAlert className="w-5 h-5 text-red-400" />
                  )}
                </div>
                <div className="flex-1">
                  <div
                    className={`text-sm font-medium ${
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
                  </div>
                  {entry.detail && (
                    <div className="text-xs text-slate-400 mt-0.5 break-all">
                      {entry.detail}
                    </div>
                  )}
                </div>
                {entry.id === "start" && containerId && (
                  <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 font-mono text-xs">
                    {containerId}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </Card>

        <TerminalLog
          logs={logs}
          title="Deploy event stream"
          emptyLabel="Deploy has not started yet."
          maxHeight="360px"
        />

        {yamlSnapshot && typeof yamlSnapshot === "string" && (
          <Card className="mt-6 p-5 bg-slate-900 border-slate-800">
            <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <PackageSearch className="w-5 h-5 text-slate-300" /> Input summary
            </h3>
            <p className="text-sm text-slate-400 font-mono break-all">
              {yamlSnapshot}
            </p>
          </Card>
        )}

        {containerId && (
          <Card className="mt-6 p-4 bg-blue-500/10 border-blue-500/30 flex items-center justify-between">
            <p className="text-sm text-blue-200">
              Container <span className="font-mono">{containerId}</span> is up.
              Open live metrics to inspect CPU and memory.
            </p>
            <Button
              size="sm"
              onClick={goMonitoring}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <ExternalLink className="w-4 h-4 mr-2" /> Open monitoring
            </Button>
          </Card>
        )}
      </div>
    </Layout>
  );
}
