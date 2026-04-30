import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Layout } from "../components/Layout";
import { ProgressStep } from "../components/ProgressStep";
import { Card } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Button } from "../components/ui/button";
import { TerminalLog, type TerminalLogEntry } from "../components/TerminalLog";
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

  const [steps, setSteps] = useState<AnalysisStep[]>(() =>
    BASE_STEPS.map((step) => ({ ...step })),
  );
  const [jobId, setJobId] = useState<string | null>(queryJobId);
  const [jobStatus, setJobStatus] = useState<Job["status"] | null>(null);
  const [progressValue, setProgressValue] = useState<number>(queryJobId ? 15 : 5);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<TerminalLogEntry[]>([]);
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
    setStep("queued", "complete");
    setStep("running", "complete");
    setStep("finalize", "complete");
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
    closeSocket();
    setTimeout(() => {
      navigate(`/results?jobId=${latestJob.id}`);
    }, 400);
  };

  const handleFailed = (message: string) => {
    setJobStatus("failed");
    failAllRemaining(message);
    toast.error(message);
    closeSocket();
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        let activeJobId = queryJobId;

        if (!activeJobId) {
          const storedFile = sessionStorage.getItem("uploadedFile");
          if (!storedFile) {
            navigate("/");
            return;
          }
          const uploadedFile = JSON.parse(storedFile) as {
            name: string;
            content: string;
            type: string;
          };
          pushLog({
            message: `Uploading ${uploadedFile.name} to the analysis queue...`,
            tone: "info",
          });
          const file = new File([uploadedFile.content], uploadedFile.name, {
            type: "text/plain",
          });
          const response =
            uploadedFile.type === "docker-compose"
              ? await composeApi.analyze(file)
              : await dockerfileApi.analyze(file);
          if (cancelled) return;
          activeJobId = response.job_id;
          setJobId(activeJobId);
          setJobStatus("queued");
          setProgressValue(25);
          pushLog({
            message: `Job ${activeJobId} queued (status: ${response.status})`,
            tone: "success",
          });
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
            setStep("running", "running");
            setProgressValue(50);
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
              parsed.event_name === "user.analysis.failed"
                ? "error"
                : parsed.event_name === "user.analysis.completed"
                  ? "success"
                  : "info";
            pushLog({
              message: `${parsed.event_name}`,
              timestamp: parsed.timestamp,
              tone,
            });
            if (parsed.event_name === "user.analysis.started") {
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
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Analyzing Your Docker Configuration
          </h1>
          <p className="text-slate-400">
            {jobId
              ? `Live updates for job ${jobId}`
              : "Submitting your file to the analysis queue..."}
          </p>
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
    </Layout>
  );
}
