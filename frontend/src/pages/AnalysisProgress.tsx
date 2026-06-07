import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Layout } from "../components/Layout";
import { ProgressStep } from "../components/ProgressStep";
import { MotionPage } from "../components/motion";
import { Card } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Button } from "../components/ui/button";
import { TerminalLog, type TerminalLogEntry } from "../components/TerminalLog";
import { pushNotification } from "../utils/notifications";
import {
  ApiError,
  compose as composeApi,
  dockerfile as dockerfileApi,
  jobs as jobsApi,
  ws,
  type DomainEvent,
  type Job,
} from "../utils/api";

type StepStatus = "pending" | "running" | "complete" | "error";

interface StoredUploadedFile {
  name: string;
  content: string;
  type: string;
}

/** Survives StrictMode remount so upload enqueue runs at most once per file. */
let uploadEnqueuePromise: Promise<string> | null = null;

async function enqueueUploadedFile(uploadedFile: StoredUploadedFile): Promise<string> {
  const file = new File([uploadedFile.content], uploadedFile.name, {
    type: "text/plain",
  });
  const response =
    uploadedFile.type === "docker-compose"
      ? await composeApi.analyze(file)
      : await dockerfileApi.analyze(file);
  return response.job_id;
}

interface AnalysisStep {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
}

const BASE_STEPS: AnalysisStep[] = [
  {
    id: "queued",
    label: "Job Queued",
    description: "Waiting for a worker to pick up the analysis",
    status: "running",
  },
  {
    id: "running",
    label: "Running Analysis Plugins",
    description: "Hadolint, security scanner, runnability, resource estimation",
    status: "pending",
  },
  {
    id: "finalize",
    label: "Finalizing Results",
    description: "Aggregating findings and computing score",
    status: "pending",
  },
];

const PROJECT_CORE_STEPS: AnalysisStep[] = [
  {
    id: "queued",
    label: "Job Queued",
    description: "Waiting for a worker to pick up the project analysis",
    status: "running",
  },
  {
    id: "project.analysis_started",
    label: "Analysis Started",
    description: "Preparing project files for analysis",
    status: "pending",
  },
  {
    id: "project.file_analysis",
    label: "Analyzing Files",
    description: "Running plugins on each Dockerfile and Compose file",
    status: "pending",
  },
  {
    id: "project.merge_started",
    label: "Merging Results",
    description: "Aggregating per-file results and computing project score",
    status: "pending",
  },
  {
    id: "finalize",
    label: "Complete",
    description: "Project analysis report ready",
    status: "pending",
  },
];

const PROJECT_IMAGE_BUILD_STEP_TEMPLATE: AnalysisStep = {
  id: "project.image_build",
  label: "Building Images",
  description: "Building Docker images from selected Dockerfiles",
  status: "pending",
};

const PROJECT_COMPOSE_RUN_STEP_TEMPLATE: AnalysisStep = {
  id: "project.compose_run",
  label: "Running Stack",
  description: "Starting compose stack for runtime analysis",
  status: "pending",
};

const PROJECT_IMAGE_BUILD_EVENTS = new Set([
  "project.image_build_started",
  "project.image_build_log",
  "project.image_build_completed",
  "project.image_build_failed",
]);

const PROJECT_RUNTIME_STEP_EVENTS = new Set([
  "container.started",
  "container.exited",
  "project.runtime_stopped",
]);

function cloneSteps(steps: AnalysisStep[]): AnalysisStep[] {
  return steps.map((s) => ({ ...s }));
}

function ensureProjectCoreSteps(prev: AnalysisStep[]): AnalysisStep[] {
  if (prev.some((s) => s.id === "project.analysis_started")) {
    return cloneSteps(prev);
  }
  return PROJECT_CORE_STEPS.map((s) => ({ ...s }));
}

/** Inserts a clone of template before `finalize` if that step id is not already present. */
function insertOptionalStepBeforeFinalize(
  steps: AnalysisStep[],
  template: AnalysisStep,
): AnalysisStep[] {
  if (steps.some((s) => s.id === template.id)) {
    return steps;
  }
  const fi = steps.findIndex((s) => s.id === "finalize");
  if (fi === -1) {
    return steps;
  }
  const row: AnalysisStep = { ...template, status: "pending" };
  return [...steps.slice(0, fi), row, ...steps.slice(fi)];
}

function augmentProjectStepsForEvent(prev: AnalysisStep[], eventName: string): AnalysisStep[] {
  let next = ensureProjectCoreSteps(prev);
  if (PROJECT_IMAGE_BUILD_EVENTS.has(eventName)) {
    next = insertOptionalStepBeforeFinalize(next, PROJECT_IMAGE_BUILD_STEP_TEMPLATE);
  }
  if (PROJECT_RUNTIME_STEP_EVENTS.has(eventName)) {
    next = insertOptionalStepBeforeFinalize(next, PROJECT_COMPOSE_RUN_STEP_TEMPLATE);
  }
  return next;
}

// Map project event names to step IDs
const PROJECT_EVENT_TO_STEP: Record<string, string> = {
  "project.analysis_started": "project.analysis_started",
  "project.file_analysis_started": "project.file_analysis",
  "project.file_analysis_completed": "project.file_analysis",
  "project.merge_started": "project.merge_started",
  "project.analysis_completed": "finalize",
  "project.image_build_started": "project.image_build",
  "project.image_build_log": "project.image_build",
  "project.image_build_completed": "project.image_build",
  "project.image_build_failed": "project.image_build",
  "container.started": "project.compose_run",
  "container.exited": "project.compose_run",
  "project.runtime_stopped": "project.compose_run",
};

function progressForStatus(status: Job["status"], stepsCompleted: number): number {
  if (status === "done") return 100;
  if (status === "failed") return 100;
  if (status === "running") return Math.min(90, 40 + stepsCompleted * 20);
  return 15;
}

export function AnalysisProgress() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryJobId = searchParams.get("jobId");

  const [isProjectJob, setIsProjectJob] = useState(false);
  const [steps, setSteps] = useState<AnalysisStep[]>(() =>
    BASE_STEPS.map((step) => ({ ...step })),
  );
  const jobId = queryJobId;
  const [jobStatus, setJobStatus] = useState<Job["status"] | null>(null);
  const [progressValue, setProgressValue] = useState<number>(queryJobId ? 15 : 5);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<TerminalLogEntry[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const pushLog = (entry: TerminalLogEntry) => {
    setLogs((prev) => [...prev, entry]);
  };

  const setStep = (id: string, status: StepStatus) => {
    setSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, status } : step)),
    );
  };

  const failAllRemaining = (message: string) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.status === "complete" ? step : { ...step, status: "error" },
      ),
    );
    setErrorMessage(message);
    setProgressValue(100);
  };

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

  const handleCompleted = (latestJob: Job) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.status === "complete" ? step : { ...step, status: "complete" as StepStatus },
      ),
    );
    setProgressValue(100);
    setJobStatus("done");
    try {
      sessionStorage.setItem("analysisJobId", latestJob.id);
      sessionStorage.setItem(
        "analysisResults",
        JSON.stringify(latestJob.result ?? {}),
      );
    } catch {
      // sessionStorage may be blocked; safe to ignore
    }
    toast.success("Analysis complete");
    pushNotification("success", "Analysis Complete", `Job ${latestJob.id.slice(0, 8)} finished successfully`, {
      dedupeKey: `analysis.completed:${latestJob.id}`,
    });
    closeSocket();
    setTimeout(() => {
      navigate(`/results?jobId=${latestJob.id}`);
    }, 400);
  };

  const handleFailed = (message: string) => {
    setJobStatus("failed");
    failAllRemaining(message);
    toast.error(message);
    pushNotification("error", "Analysis Failed", message, {
      dedupeKey: `analysis.failed:${jobId ?? "unknown"}`,
    });
    closeSocket();
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        let activeJobId = queryJobId;

        if (!activeJobId) {
          const storedFile = sessionStorage.getItem("uploadedFile");
          if (!storedFile && !uploadEnqueuePromise) {
            navigate("/");
            return;
          }

          if (!uploadEnqueuePromise && storedFile) {
            const uploadedFile = JSON.parse(storedFile) as StoredUploadedFile;
            pushLog({
              message: `Uploading ${uploadedFile.name} to the analysis queue...`,
              tone: "info",
            });
            uploadEnqueuePromise = enqueueUploadedFile(uploadedFile).finally(() => {
              uploadEnqueuePromise = null;
            });
          }

          if (uploadEnqueuePromise) {
            activeJobId = await uploadEnqueuePromise;
            if (cancelled) return;
            sessionStorage.setItem("analysisJobId", activeJobId);
            navigate(`/analysis?jobId=${activeJobId}`, { replace: true });
            return;
          }
        } else {
          pushLog({
            message: `Attaching to existing job ${activeJobId}`,
            tone: "info",
          });
        }

        if (!activeJobId) return;

        try {
          const reconciled = await jobsApi.getEvents(activeJobId);
          if (cancelled) return;
          setJobStatus(reconciled.status);
          // Switch to project step list if needed
          if (reconciled.type === "project") {
            setIsProjectJob(true);
            setSteps(PROJECT_CORE_STEPS.map((s) => ({ ...s })));
          }
          if (reconciled.status === "done") {
            handleCompleted(reconciled);
            return;
          }
          if (reconciled.status === "failed") {
            const msg =
              (reconciled.result && typeof reconciled.result === "object"
                ? (reconciled.result as { message?: string }).message
                : undefined) ?? "Analysis failed.";
            handleFailed(msg);
            return;
          }
          if (reconciled.status === "running") {
            setStep("queued", "complete");
            if (reconciled.type === "project") {
              setProgressValue(50);
            } else {
              setStep("running", "running");
              setProgressValue(50);
            }
          }
        } catch (error) {
          if (error instanceof ApiError && error.status !== 404) {
            pushLog({
              message: `Reconcile failed: ${error.message}`,
              tone: "warning",
            });
          }
        }

        const socket = ws.connectJob(activeJobId);
        socketRef.current = socket;

        socket.onopen = () => {
          pushLog({
            message: `Connected to job events stream for ${activeJobId}`,
            tone: "success",
          });
        };
        socket.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data as string) as DomainEvent;
            const tone: TerminalLogEntry["tone"] =
              parsed.event_name === "user.analysis.failed" || parsed.event_name === "project.analysis_failed"
                ? "error"
                : parsed.event_name === "user.analysis.completed" || parsed.event_name === "project.analysis_completed"
                  ? "success"
                  : "info";

            // Build human-readable log message
            let logMsg = parsed.event_name;
            const pl = parsed.payload as Record<string, unknown>;
            if (parsed.event_name === "project.file_analysis_started" && pl.file) {
              logMsg = `Analyzing ${pl.type ?? "file"}: ${pl.file}`;
              setCurrentFile(String(pl.file));
            } else if (parsed.event_name === "project.file_analysis_completed" && pl.file) {
              logMsg = `Completed: ${pl.file}`;
              setCurrentFile(null);
            } else if (parsed.event_name === "deploy.compose_up_log" && pl.line) {
              logMsg = String(pl.line);
            } else if (parsed.event_name === "project.image_build_started") {
              logMsg = `Building image: ${pl.dockerfile_path ?? pl.image_tag ?? ""}`;
            } else if (parsed.event_name === "project.image_build_log") {
              logMsg = String(pl.line ?? "");
            } else if (parsed.event_name === "project.image_build_completed") {
              logMsg = `Built ${pl.image_tag ?? ""} (${pl.image_id ?? ""})`;
            } else if (parsed.event_name === "project.image_build_failed") {
              logMsg = `Build failed: ${pl.dockerfile_path ?? ""} — ${pl.error ?? "unknown error"}`;
            } else if (parsed.event_name === "container.exited") {
              logMsg = `Container exited (code ${pl.exit_code ?? "??"})`;
            } else if (parsed.event_name === "project.runtime_stopped") {
              logMsg = "All containers exited.";
            }

            if (logMsg) {
              pushLog({ message: logMsg, timestamp: parsed.timestamp, tone });
            }

            // Update steps for project events
            if (parsed.event_name.startsWith("project.") || parsed.event_name === "container.started" || parsed.event_name === "container.exited" || parsed.event_name === "project.runtime_stopped") {
              setIsProjectJob(true);
              setSteps((prev) => augmentProjectStepsForEvent(prev, parsed.event_name));
              if (parsed.event_name === "project.analysis_failed") {
                const message = (parsed.payload as { message?: string })?.message ?? "Project analysis failed.";
                handleFailed(message);
              } else {
                const targetStep = PROJECT_EVENT_TO_STEP[parsed.event_name];
                if (targetStep) {
                  if (parsed.event_name === "project.analysis_started") {
                    setStep("queued", "complete");
                    setStep("project.analysis_started", "running");
                    setJobStatus("running");
                    setProgressValue(20);
                  } else if (parsed.event_name === "project.file_analysis_started") {
                    setStep("project.analysis_started", "complete");
                    setStep("project.file_analysis", "running");
                    setProgressValue(45);
                  } else if (parsed.event_name === "project.merge_started") {
                    setStep("project.file_analysis", "complete");
                    setStep("project.merge_started", "running");
                    setProgressValue(80);
                  } else if (parsed.event_name === "project.analysis_completed") {
                    setStep("project.merge_started", "complete");
                    setSteps((prev) =>
                      prev.map((s) =>
                        s.id === "project.image_build" && s.status !== "error"
                          ? { ...s, status: "complete" as StepStatus }
                          : s,
                      ),
                    );
                    setStep("finalize", "running");
                    setProgressValue(95);
                  } else if (parsed.event_name === "project.image_build_started") {
                    setStep("project.merge_started", "complete");
                    setStep("project.image_build", "running");
                    setProgressValue(85);
                  } else if (parsed.event_name === "project.image_build_log" || parsed.event_name === "project.image_build_completed") {
                    setStep("project.image_build", "running");
                  } else if (parsed.event_name === "project.image_build_failed") {
                    // Mark as error but don't fail job
                    setStep("project.image_build", "error");
                  } else if (parsed.event_name === "container.started") {
                    setSteps((prev) =>
                      prev.map((s) =>
                        s.id === "project.image_build" && s.status !== "error"
                          ? { ...s, status: "complete" as StepStatus }
                          : s,
                      ),
                    );
                    setStep("project.compose_run", "running");
                    setProgressValue(90);
                  } else if (parsed.event_name === "container.exited") {
                    setStep("project.compose_run", "error");
                  } else if (parsed.event_name === "project.runtime_stopped") {
                    setStep("project.compose_run", "complete");
                    setProgressValue(95);
                  }
                }
              }
            } else if (parsed.event_name === "user.analysis.started") {
              setStep("queued", "complete");
              setStep("running", "running");
              setJobStatus("running");
              setProgressValue(50);
            } else if (parsed.event_name === "user.analysis.completed") {
              jobsApi
                .get(activeJobId!)
                .then((job) => {
                  if (!cancelled) handleCompleted(job);
                })
                .catch(() => {
                  if (!cancelled) {
                    handleCompleted({
                      id: activeJobId!,
                      type: "dockerfile",
                      status: "done",
                      input_metadata: {},
                      result:
                        (parsed.payload as Job["result"]) ?? null,
                      created_at: parsed.timestamp,
                    });
                  }
                });
            } else if (parsed.event_name === "user.analysis.failed") {
              const message =
                (parsed.payload as { message?: string })?.message ??
                "Analysis failed.";
              handleFailed(message);
            }
          } catch {
            pushLog({ message: String(event.data), tone: "info" });
          }
        };
        socket.onerror = () => {
          pushLog({ message: "Event stream error", tone: "error" });
        };
        socket.onclose = () => {
          if (!cancelled && jobStatus !== "done" && jobStatus !== "failed") {
            pushLog({ message: "Event stream closed", tone: "warning" });
          }
        };
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Failed to start analysis.";
        handleFailed(message);
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
      closeSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryJobId]);

  const progress = useMemo(() => {
    const completed = steps.filter((s) => s.status === "complete").length;
    if (jobStatus) return progressForStatus(jobStatus, completed);
    return progressValue;
  }, [steps, jobStatus, progressValue]);

  return (
    <Layout>
      <MotionPage>
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            {isProjectJob ? "Analyzing Project Archive" : "Analyzing Your Docker Configuration"}
          </h1>
          <p className="text-slate-400">
            {jobId
              ? `Live updates for job ${jobId}`
              : "Submitting your file to the analysis queue..."}
          </p>
          {isProjectJob && currentFile && (
            <p className="text-blue-400 text-sm mt-2 font-mono">
              → {currentFile}
            </p>
          )}
        </div>

        <Card className="p-6 bg-slate-900 border-slate-800 mb-8">
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-400">Overall Progress</span>
              <span className="text-blue-400 font-mono">
                {Math.round(progress)}%
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {steps.map((step) => (
              <div
                key={step.id}
                className={`h-1 rounded-full transition-colors ${
                  step.status === "complete"
                    ? "bg-green-500"
                    : step.status === "running"
                      ? "bg-blue-500"
                      : step.status === "error"
                        ? "bg-red-500"
                        : "bg-slate-700"
                }`}
              />
            ))}
          </div>
        </Card>

        <div className="space-y-3 mb-6">
          {steps.map((step) => (
            <ProgressStep
              key={step.id}
              label={step.label}
              description={step.description}
              status={step.status}
            />
          ))}
        </div>

        <TerminalLog
          logs={logs}
          title="Job Event Stream"
          emptyLabel="Waiting for events..."
        />

        {errorMessage && (
          <Card className="mt-6 p-4 bg-red-950/20 border-red-800">
            <p className="text-red-300 mb-3">{errorMessage}</p>
            <div className="flex gap-3">
              <Button onClick={() => window.location.reload()} variant="outline">
                Retry
              </Button>
              <Button
                onClick={() => navigate("/")}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Back to Upload
              </Button>
            </div>
          </Card>
        )}
      </div>
      </MotionPage>
    </Layout>
  );
}
