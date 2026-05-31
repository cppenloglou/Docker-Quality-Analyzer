import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Download,
  HardDrive,
  Info,
  Layers,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Shield,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";

import { DockerLoader, useMinLoader } from "../components/DockerLoader";
import { Layout } from "../components/Layout";
import { CodePreview } from "../components/CodePreview";
import { FileAnalysisDetail } from "../components/FileAnalysisDetail";
import { MotionPage, AnimatedNumber, StaggerList, StaggerItem } from "../components/motion";
import { motion, useReducedMotion } from "motion/react";
import { scoreVariants, scoreTransition, badgePopVariants, badgePopTransition } from "../components/motion/variants";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  ApiError,
  compose as composeApi,
  jobs as jobsApi,
  project as projectApi,
  type AnalysisResult,
  type ImageBuildResult,
  type Issue,
  type Job,
  type PerFileAnalysisResult,
  type ProjectAnalysisResult,
  type RunnabilityMeta,
  type ServiceBuildMapping,
} from "../utils/api";
import { pushNotification } from "../utils/notifications";

interface UploadedFile {
  name: string;
  type: string;
  content: string;
}

function scoreColor(score: number) {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  return "text-red-400";
}

function gradeColor(grade: string) {
  if (grade === "A") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (grade === "B") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { errors?: unknown }).errors) &&
    Array.isArray((value as { warnings?: unknown }).warnings)
  );
}

function isProjectAnalysisResult(value: unknown): value is ProjectAnalysisResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.per_file_results) &&
    !!v.project_summary &&
    typeof v.project_summary === "object" &&
    (typeof v.score === "number" || typeof v.overall_score === "number")
  );
}

function asRunnabilityMeta(value: unknown): RunnabilityMeta | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { runnable?: unknown; reasons?: unknown; rules?: unknown };
  if (typeof raw.runnable !== "boolean") return undefined;
  const reasons = Array.isArray(raw.reasons) ? raw.reasons.filter((r): r is string => typeof r === "string") : [];
  const rulesObj = raw.rules;
  let rules: Record<string, boolean> | undefined;
  if (rulesObj && typeof rulesObj === "object") {
    rules = {};
    for (const [rule, passed] of Object.entries(rulesObj as Record<string, unknown>)) {
      if (typeof passed === "boolean") rules[rule] = passed;
    }
    if (Object.keys(rules).length === 0) {
      rules = undefined;
    }
  }
  return { runnable: raw.runnable, reasons, rules };
}

function composeRunnabilityEntriesFromProject(
  result: ProjectAnalysisResult | null,
): Array<{ filePath: string; runnability: RunnabilityMeta }> {
  if (!result) return [];
  return (result.per_file_results ?? [])
    .filter((file): file is PerFileAnalysisResult => file.file_type === "compose")
    .flatMap((file) => {
      const runnability = asRunnabilityMeta((file.meta as { runnability?: unknown } | undefined)?.runnability);
      return runnability ? [{ filePath: file.file_path, runnability }] : [];
    });
}

export function ResultsDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryJobId = searchParams.get("jobId");

  const [job, setJob] = useState<Job | null>(null);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(() => {
    const stored = sessionStorage.getItem("uploadedFile");
    return stored ? (JSON.parse(stored) as UploadedFile) : null;
  });
  const [loading, setLoading] = useState(true);
  const ready = useMinLoader(!loading);
  const reducedMotion = useReducedMotion();
  const [error, setError] = useState<string | null>(null);
  const [containerStatus, setContainerStatus] = useState<"stopped" | "running" | "stopping" | "exited" | "partial" | "unhealthy" | "stopped_by_user">(() => {
    const stored = sessionStorage.getItem("dqa:containerStatus");
    if (stored === "stopping") return "stopping";
    return "stopped";
  });
  const [runtimeSelfExited, setRuntimeSelfExited] = useState(false);
  const [requiresResubmit, setRequiresResubmit] = useState(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const targetJobId =
      queryJobId || sessionStorage.getItem("analysisJobId") || null;

    if (!targetJobId) {
      setLoading(false);
      setError("No analysis job to display.");
      return;
    }

    (async () => {
      try {
        const fetched = await jobsApi.get(targetJobId);
        if (cancelled) return;
        setJob(fetched);
        sessionStorage.setItem("analysisJobId", fetched.id);
        if (fetched.result) {
          sessionStorage.setItem(
            "analysisResults",
            JSON.stringify(fetched.result),
          );
        }

        const metaFilename =
          (fetched.input_metadata?.filename as string | undefined) ??
          "uploaded file";
        if (!uploadedFile) {
          setUploadedFile({
            name: metaFilename,
            type: fetched.type === "compose" ? "docker-compose" : fetched.type,
            content: "",
          });
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load job.";
        setError(message);
        toast.error(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryJobId]);

  useEffect(() => {
    if (!job) return;
    const key = `dqa:resubmitRequired:${job.id}`;
    setRequiresResubmit(sessionStorage.getItem(key) === "1");
  }, [job?.id, job]);

  const reconcileDeployStatus = useCallback(async (jobId: string) => {
    try {
      const status = await composeApi.deployStatus(jobId);

      const rs = status.runtime_state ?? "none";
      const sessionStopping =
        typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem("dqa:containerStatus") === "stopping";

      const treatAsStopping =
        rs === "stopping" ||
        Boolean(status.active && sessionStopping);

      if (treatAsStopping) {
        setContainerStatus("stopping");
        return;
      }

      // Backend is authoritative — check explicit states first
      if (rs === "stopped_by_user") {
        setContainerStatus("stopped_by_user");
        setRuntimeSelfExited(false);
        sessionStorage.removeItem("dqa:containerStatus");
        return;
      }
      if (rs === "exited" || rs === "failed" || rs === "cleanup_completed") {
        if (status.stopped_by_user || status.stop_reason === "user_requested") {
          setContainerStatus("stopped_by_user");
          setRuntimeSelfExited(false);
          sessionStorage.removeItem("dqa:containerStatus");
          return;
        }
        setContainerStatus("exited");
        setRuntimeSelfExited(!status.stopped_by_user);
        sessionStorage.removeItem("dqa:containerStatus");
        return;
      }
      if (rs === "running") {
        setContainerStatus("running");
        sessionStorage.removeItem("dqa:containerStatus");
      } else if (rs === "partial") {
        setContainerStatus("partial");
        sessionStorage.removeItem("dqa:containerStatus");
      } else if (rs === "unhealthy") {
        setContainerStatus("unhealthy");
        sessionStorage.removeItem("dqa:containerStatus");
      } else {
        const exitedCount = status.exited_count ?? 0;
        const runningCount = status.running_count ?? 0;
        const unhealthyCount = status.unhealthy_count ?? 0;
        if (!status.active) {
          if (exitedCount > 0 && runningCount === 0) {
            setContainerStatus("exited");
            setRuntimeSelfExited(!status.stopped_by_user);
          } else {
            setContainerStatus("stopped");
            setRuntimeSelfExited(false);
            sessionStorage.removeItem("dqa:containerStatus");
          }
        } else if (unhealthyCount > 0) {
          setContainerStatus("unhealthy");
        } else if (exitedCount > 0 && runningCount > 0) {
          setContainerStatus("partial");
        } else if (exitedCount > 0 && runningCount === 0) {
          setContainerStatus("exited");
          setRuntimeSelfExited(!status.stopped_by_user);
        } else {
          setContainerStatus("running");
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!job || (job.type !== "compose" && job.type !== "project")) return;
    void reconcileDeployStatus(job.id);

    const handleFocus = () => void reconcileDeployStatus(job.id);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [job, reconcileDeployStatus]);

  const standardResult = useMemo<AnalysisResult | null>(() => {
    if (!job?.result) return null;
    return isAnalysisResult(job.result) ? job.result : null;
  }, [job]);

  const projectResult = useMemo<ProjectAnalysisResult | null>(() => {
    if (!job?.result) return null;
    return isProjectAnalysisResult(job.result) ? job.result : null;
  }, [job]);

  const failureMessage = useMemo(() => {
    if (!job) return null;
    if (isAnalysisResult(job.result) || isProjectAnalysisResult(job.result)) return null;
    const r = job.result as { message?: string } | null;
    return r?.message ?? null;
  }, [job]);

  const highlightedLines = useMemo(() => {
    if (!standardResult) return [] as number[];
    return [
      ...standardResult.errors.map((e) => e.line),
      ...standardResult.warnings.map((w) => w.line),
      ...standardResult.securityIssues.map((s) => s.line),
    ];
  }, [standardResult]);

  const isComposeJob = job?.type === "compose";
  const isProjectJob = job?.type === "project";

  const projectComposeRunnability = useMemo(
    () => composeRunnabilityEntriesFromProject(projectResult),
    [projectResult],
  );

  // Local override for the selected primary compose — starts from job metadata, can be changed by user in the results page.
  const [localPrimaryCompose, setLocalPrimaryCompose] = useState<string | null>(null);

  // Initialise localPrimaryCompose once we have the job / project result.
  useEffect(() => {
    if (!job || !isProjectJob) return;
    const fromMeta = job.input_metadata?.primary_compose_file;
    if (typeof fromMeta === "string" && fromMeta.trim()) {
      setLocalPrimaryCompose(fromMeta);
      return;
    }
    // Fall back to first runnable compose, then first compose.
    const runnableFirst = composeRunnabilityEntriesFromProject(projectResult).find(e => e.runnability.runnable);
    const first = runnableFirst?.filePath ?? projectComposeRunnability[0]?.filePath ?? null;
    setLocalPrimaryCompose(first);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, isProjectJob, projectResult]);

  const primaryComposeFile = localPrimaryCompose ?? (job?.input_metadata?.primary_compose_file as string | undefined | null) ?? null;

  const handlePrimaryComposeChange = useCallback(async (composePath: string) => {
    if (!job) return;
    setLocalPrimaryCompose(composePath);
    try {
      await projectApi.setPrimaryCompose(job.id, composePath);
    } catch {
      // Non-fatal: local state is already updated; backend will be retried on next deploy
    }
  }, [job]);

  const runnability = useMemo(() => {
    if (isComposeJob) {
      return asRunnabilityMeta(standardResult?.meta?.runnability);
    }
    if (isProjectJob) {
      if (projectResult?.meta?.runnability) {
        return asRunnabilityMeta(projectResult.meta.runnability);
      }
      if (projectComposeRunnability.length === 0) return undefined;
      const preferred = primaryComposeFile
        ? projectComposeRunnability.find((entry) => entry.filePath === primaryComposeFile)
        : undefined;
      return preferred?.runnability ?? projectComposeRunnability[0]?.runnability;
    }
    return undefined;
  }, [isComposeJob, isProjectJob, standardResult, projectResult, projectComposeRunnability, primaryComposeFile]);

  const problematicRuntime = useMemo(() => {
    const problematicByStatus =
      containerStatus === "partial" ||
      containerStatus === "unhealthy" ||
      (containerStatus === "exited" && runtimeSelfExited);
    return requiresResubmit || problematicByStatus;
  }, [containerStatus, runtimeSelfExited, requiresResubmit]);

  const estimate = standardResult?.meta?.estimate;
  const composeRunnable =
    (isComposeJob || isProjectJob) && runnability?.runnable === true;

  const displayScore = projectResult?.overall_score ?? projectResult?.score ?? standardResult?.score;
  const displayGrade = projectResult?.overall_grade ?? projectResult?.grade ?? standardResult?.grade;

  const errorCount = projectResult?.project_summary?.total_errors ?? standardResult?.errors.length ?? 0;
  const warningCount = projectResult?.project_summary?.total_warnings ?? standardResult?.warnings.length ?? 0;
  const securityCount = projectResult?.project_summary?.total_security_issues ?? standardResult?.securityIssues.length ?? 0;

  const detectedFiles = useMemo(() => {
    const meta = job?.input_metadata ?? {};
    return {
      dockerfiles: (meta.dockerfiles as string[] | undefined) ?? [],
      composeFiles: (meta.compose_files as string[] | undefined) ?? [],
    };
  }, [job]);

  const handleRunContainers = () => {
    if (containerStatus === "running" && job) {
      navigate(`/execution?jobId=${job.id}`);
    } else if (composeRunnable && job) {
      navigate(`/execution?jobId=${job.id}`);
    }
  };

  const handleStopContainers = async () => {
    if (
      !job ||
      (containerStatus !== "running" &&
        containerStatus !== "partial" &&
        containerStatus !== "unhealthy")
    ) {
      return;
    }
    const previousStatus = containerStatus;
    setContainerStatus("stopping");
    sessionStorage.setItem("dqa:containerStatus", "stopping");
    pushNotification("info", "Stopping Containers", "Stop signal sent, waiting for shutdown...", {
      dedupeKey: `deploy.stop.requested:${job.id}`,
    });
    try {
      await composeApi.stopDeploy({ job_id: job.id });
      for (let i = 0; i < 30; i++) {
        if (unmountedRef.current) break;
        await new Promise((r) => setTimeout(r, 2000));
        if (unmountedRef.current) break;
        try {
          const status = await composeApi.deployStatus(job.id);
          if (!status.active) {
            if (unmountedRef.current) break;
            setContainerStatus("stopped");
            sessionStorage.removeItem("dqa:containerStatus");
            toast.success("Containers stopped");
            pushNotification("success", "Containers Stopped", "All containers have been successfully stopped", {
              dedupeKey: `deploy.stop.completed:${job.id}`,
            });
            return;
          }
        } catch {
          break;
        }
      }
      if (!unmountedRef.current) {
        setContainerStatus("stopped");
        sessionStorage.removeItem("dqa:containerStatus");
      }
    } catch {
      if (!unmountedRef.current) {
        setContainerStatus(previousStatus);
        sessionStorage.removeItem("dqa:containerStatus");
        toast.error("Failed to stop containers");
        pushNotification("error", "Stop Failed", "Failed to stop containers", {
          dedupeKey: `deploy.stop.failed:${job.id}`,
        });
      }
    }
  };

  const handleExport = () => {
    if (!job) return;
    const markdown = buildMarkdownReport(job, standardResult, projectResult, uploadedFile);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `analysis-${job.id}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  };

  if (!ready) {
    return (
      <Layout>
        <DockerLoader message="Loading analysis results..." fullScreen={false} />
      </Layout>
    );
  }

  if (!job) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto">
          <Card className="p-6 bg-red-950/20 border-red-800 text-red-300">
            <p className="mb-4">{error ?? "Analysis job not found."}</p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => navigate("/history")}>
                Go to History
              </Button>
              <Button
                onClick={() => navigate("/")}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Back to Home
              </Button>
            </div>
          </Card>
        </div>
      </Layout>
    );
  }

  if (failureMessage) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => navigate("/history")}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to History
          </Button>
          <Card className="p-6 bg-red-950/20 border-red-800">
            <h2 className="text-xl font-semibold text-red-300 mb-2">
              Analysis failed
            </h2>
            <p className="text-red-200 mb-4">{failureMessage}</p>
            <Button onClick={handleExport} variant="outline">
              <Download className="w-4 h-4 mr-2" /> Export Report (Markdown)
            </Button>
          </Card>
        </div>
      </Layout>
    );
  }

  if (!standardResult && !projectResult) {
    const hasUnknownResult = job.status === "done" && !!job.result;
    return (
      <Layout>
        <div className="max-w-3xl mx-auto">
          <Card className="p-6 bg-slate-900 border-slate-800 text-slate-300">
            {hasUnknownResult ? (
              <>
                <p className="mb-2 font-medium text-white">
                  Results were returned, but this result format is not supported by the dashboard yet.
                </p>
                <p className="text-xs text-slate-500 mb-4">
                  The backend returned a result object, but the dashboard type guard did not recognize its shape.
                </p>
                <Button onClick={handleExport} variant="outline">
                  <Download className="w-4 h-4 mr-2" /> Export Report (Markdown)
                </Button>
              </>
            ) : (
              <>
                <p className="mb-4">
                  Job {job.id} is {job.status}. Results are not yet available.
                </p>
                <Button onClick={() => navigate(`/analysis?jobId=${job.id}`)}>
                  Watch progress
                </Button>
              </>
            )}
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <MotionPage>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/history")}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to History
          </Button>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">
                Analysis Results
              </h1>
              <p className="text-slate-400">
                {(job.input_metadata?.filename as string | undefined) ??
                  uploadedFile?.name ??
                  job.id}
              </p>
              <p className="text-xs text-slate-500 mt-1">Job ID: {job.id}</p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleExport}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <Download className="w-4 h-4 mr-2" />
                Export Report (Markdown)
              </Button>
              {(isComposeJob || isProjectJob) &&
                !problematicRuntime &&
                (containerStatus === "stopped" || containerStatus === "stopped_by_user") && (
                <Button
                  onClick={handleRunContainers}
                  disabled={!composeRunnable}
                  title={
                    composeRunnable
                      ? "Deploy and run analyzed compose stack"
                      : "Compose stack cannot be deployed as-is. See runnability reasons."
                  }
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Play className="w-4 h-4 mr-2" />
                  {containerStatus === "stopped_by_user" ? "Run Again" : "Run Containers"}
                </Button>
              )}
              {(isComposeJob || isProjectJob) && containerStatus === "exited" && runtimeSelfExited && (
                <>
                  <Button
                    onClick={() => job && navigate(`/execution?jobId=${job.id}`)}
                    variant="outline"
                    className="border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    <Terminal className="w-4 h-4 mr-2" />
                    View Exit Details
                  </Button>
                </>
              )}
              {(isComposeJob || isProjectJob) && containerStatus === "exited" && !runtimeSelfExited && !problematicRuntime && (
                <>
                  <Button
                    onClick={handleRunContainers}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Run Again
                  </Button>
                  <Button
                    onClick={() => job && navigate(`/execution?jobId=${job.id}`)}
                    variant="outline"
                    className="border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    View Runtime Details
                  </Button>
                </>
              )}
              {(isComposeJob || isProjectJob) &&
                !problematicRuntime &&
                (containerStatus === "running" || containerStatus === "partial" || containerStatus === "unhealthy") && (
                <>
                  <Button
                    onClick={handleRunContainers}
                    className={containerStatus === "unhealthy" ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"}
                  >
                    {containerStatus === "unhealthy" ? "View Unhealthy Containers" : "Inspect Containers"}
                  </Button>
                  <Button
                    onClick={handleStopContainers}
                    variant="outline"
                    className="border-red-700 text-red-300 hover:bg-red-600/20"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    Stop
                  </Button>
                </>
              )}
              {(isComposeJob || isProjectJob) && containerStatus === "stopping" && (
                <Button disabled className="bg-slate-700">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Stopping...
                </Button>
              )}
            </div>
          </div>
        </div>

        <Card className="p-6 bg-slate-900 border-slate-800 mb-6">
          <StaggerList className="grid grid-cols-1 md:grid-cols-5 gap-6">
            <StaggerItem className="md:col-span-2 flex items-center gap-4">
              <motion.div
                className="text-center"
                initial="initial"
                animate="animate"
                variants={reducedMotion ? undefined : scoreVariants}
                transition={reducedMotion ? undefined : scoreTransition}
              >
                <div className={`text-6xl font-bold ${scoreColor(displayScore ?? 0)}`}>
                  <AnimatedNumber value={displayScore ?? 0} />
                </div>
                <div className="text-slate-400 text-sm mt-1">Quality Score</div>
                <div className="mt-1">
                  <Link
                    to="/scoring"
                    className="text-xs text-sky-400 underline-offset-2 hover:underline"
                  >
                    How scoring works
                  </Link>
                </div>
                {standardResult?.line_count && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    {standardResult.line_count} lines analyzed
                  </div>
                )}
              </motion.div>
              <motion.div
                initial="initial"
                animate="animate"
                variants={reducedMotion ? undefined : badgePopVariants}
                transition={reducedMotion ? undefined : badgePopTransition}
              >
                <Badge className={`text-2xl px-4 py-2 ${gradeColor(displayGrade ?? "-")}`}>
                  Grade {displayGrade ?? "-"}
                </Badge>
              </motion.div>
            </StaggerItem>

            <StaggerItem>
            <Card className="p-4 bg-slate-950 border-slate-700 flex items-center gap-3">
              <div className="p-2 bg-red-500/10 rounded">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">
                  {errorCount}
                </div>
                <div className="text-sm text-slate-400">Errors</div>
              </div>
            </Card>
            </StaggerItem>

            <StaggerItem>
            <Card className="p-4 bg-slate-950 border-slate-700 flex items-center gap-3">
              <div className="p-2 bg-yellow-500/10 rounded">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">
                  {warningCount}
                </div>
                <div className="text-sm text-slate-400">Warnings</div>
              </div>
            </Card>
            </StaggerItem>

            <StaggerItem>
            <Card className="p-4 bg-slate-950 border-slate-700 flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded">
                <Shield className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">
                  {securityCount}
                </div>
                <div className="text-sm text-slate-400">Security</div>
              </div>
            </Card>
            </StaggerItem>
          </StaggerList>
        </Card>

        {(isComposeJob || isProjectJob) && problematicRuntime && (
          <Card className="p-5 bg-red-950/20 border-red-800 mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-red-300 mb-1">
                  Stack is problematic - resubmission required
                </h3>
                <p className="text-red-200/80 text-sm mb-3">
                  This runtime is not stable. Please fix your project/compose configuration and upload again before deploying.
                  Analysis results remain available below for troubleshooting.
                </p>
                <p className="text-red-200/60 text-sm font-medium">Next steps:</p>
                <ol className="text-red-200/70 text-sm list-decimal list-inside space-y-1 mt-1">
                  <li>Open runtime logs from View Exit Details / View Runtime Details</li>
                  <li>Fix compose/services locally</li>
                  <li>Resubmit (new upload) and redeploy</li>
                </ol>
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => job && navigate(`/execution?jobId=${job.id}`)}
                    className="border-red-700 text-red-300 hover:bg-red-900/20"
                  >
                    <Terminal className="w-4 h-4 mr-2" />
                    View Runtime Details
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {estimate && (
          <Card className="p-5 bg-slate-900 border-slate-800 mb-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              Resource Estimate
            </h3>
            {estimate.explanation && (
              <p className="text-sm text-slate-400 mb-4">
                {estimate.explanation}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              {estimate.estimated_layers != null && (
                <div className="flex items-center gap-3 p-3 rounded bg-slate-950 border border-slate-800">
                  <Layers className="w-5 h-5 text-blue-400" />
                  <div>
                    <div className="text-xs text-slate-400">Image layers (RUN/COPY/ADD)</div>
                    <div className="text-lg text-white font-semibold">
                      {estimate.estimated_layers}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3 p-3 rounded bg-slate-950 border border-slate-800">
                <HardDrive className="w-5 h-5 text-purple-400" />
                <div>
                  <div className="text-xs text-slate-400">
                    {estimate.total_estimated_memory_mb != null ? "Total memory (all services)" : "Estimated runtime memory"}
                  </div>
                  <div className="text-lg text-white font-semibold">
                    {estimate.total_estimated_memory_mb != null
                      ? `${estimate.total_estimated_memory_mb} MB`
                      : `${estimate.estimated_memory_mb ?? "-"} MB`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded bg-slate-950 border border-slate-800">
                <Cpu className="w-5 h-5 text-emerald-400" />
                <div>
                  <div className="text-xs text-slate-400">
                    {estimate.total_estimated_cpu_millicores != null ? "Total CPU (all services)" : "Estimated CPU"}
                  </div>
                  <div className="text-lg text-white font-semibold">
                    {estimate.total_estimated_cpu_millicores != null
                      ? `${estimate.total_estimated_cpu_millicores}m`
                      : `${estimate.estimated_cpu_millicores ?? "-"}m`}
                  </div>
                </div>
              </div>
            </div>
            {estimate.services && estimate.services.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Per-service breakdown</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {estimate.services.map((svc, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800 text-xs">
                      <div>
                        <span className="text-slate-200 font-mono">{svc.name}</span>
                        {svc.image && <span className="text-slate-500 ml-2">{svc.image}</span>}
                      </div>
                      <div className="text-slate-400">
                        {svc.estimated_memory_mb}MB / {svc.estimated_cpu_millicores}m
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {isComposeJob && (
          <div className="mb-6">
            <RunnabilityDetailCard title="Deploy Runnability" runnability={runnability} />
          </div>
        )}

        {isProjectJob &&
          (detectedFiles.dockerfiles.length > 0 ||
            detectedFiles.composeFiles.length > 0) && (
            <Card className="p-5 bg-slate-900 border-slate-800 mb-6">
              <h3 className="text-lg font-semibold text-white mb-3">
                Detected files in archive
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-slate-400 mb-2">Dockerfiles</div>
                  {detectedFiles.dockerfiles.length === 0 ? (
                    <p className="text-slate-500 italic">None found</p>
                  ) : (
                    <ul className="space-y-1 text-slate-300 font-mono">
                      {detectedFiles.dockerfiles.map((path) => (
                        <li key={path} className="truncate">
                          {path}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-slate-400 mb-2">Compose files</div>
                  {detectedFiles.composeFiles.length === 0 ? (
                    <p className="text-slate-500 italic">None found</p>
                  ) : (
                    <ul className="space-y-1 text-slate-300 font-mono">
                      {detectedFiles.composeFiles.map((path) => (
                        <li key={path} className="truncate">
                          {path}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          )}

        {/* Exited containers card */}
        {(isComposeJob || isProjectJob) && containerStatus === "exited" && (
          <Card className="p-5 bg-amber-950/20 border-amber-800/50 mb-6">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h3 className="text-base font-semibold text-amber-300 mb-1">Containers Exited</h3>
                <p className="text-sm text-amber-200/70">
                  All containers have stopped running. Review runtime details before resubmitting a fixed stack.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/execution?jobId=${job.id}`)}
                  className="border-amber-700 text-amber-300 hover:bg-amber-900/30"
                >
                  View Runtime Details
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Partial / unhealthy containers card */}
        {(isComposeJob || isProjectJob) && !problematicRuntime && (containerStatus === "partial" || containerStatus === "unhealthy") && (
          <Card className={`p-5 mb-6 ${
            containerStatus === "unhealthy"
              ? "bg-red-950/20 border-red-800/50"
              : "bg-amber-950/20 border-amber-800/50"
          }`}>
            <div className="flex items-center gap-3">
              <AlertTriangle className={`w-5 h-5 shrink-0 ${containerStatus === "unhealthy" ? "text-red-400" : "text-amber-400"}`} />
              <p className={`text-sm font-semibold ${containerStatus === "unhealthy" ? "text-red-300" : "text-amber-300"}`}>
                {containerStatus === "partial"
                  ? "Some containers have exited — stack is running partially."
                  : "One or more containers are unhealthy."}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/monitoring/${job.id}`)}
                className="ml-auto border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                View Metrics
              </Button>
            </div>
          </Card>
        )}

        {isProjectJob && projectResult && (
          <ProjectResultsSection
            result={projectResult}
            job={job}
            deployComposePath={primaryComposeFile}
            onPrimaryComposeChange={handlePrimaryComposeChange}
          />
        )}

        {standardResult && (
          <Tabs defaultValue="all" className="mb-6">
            <TabsList className="bg-slate-900 border border-slate-800">
              <TabsTrigger value="all">All Issues</TabsTrigger>
              <TabsTrigger value="errors">
                Errors ({standardResult.errors.length})
              </TabsTrigger>
              <TabsTrigger value="warnings">
                Warnings ({standardResult.warnings.length})
              </TabsTrigger>
              <TabsTrigger value="security">
                Security ({standardResult.securityIssues.length})
              </TabsTrigger>
              <TabsTrigger value="suggestions">
                Suggestions ({standardResult.suggestions.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-6 space-y-3">
              {renderIssues([
                ...standardResult.errors,
                ...standardResult.warnings,
                ...standardResult.securityIssues,
                ...standardResult.suggestions,
              ])}
            </TabsContent>
            <TabsContent value="errors" className="mt-6 space-y-3">
              {renderIssues(standardResult.errors)}
            </TabsContent>
            <TabsContent value="warnings" className="mt-6 space-y-3">
              {renderIssues(standardResult.warnings)}
            </TabsContent>
            <TabsContent value="security" className="mt-6 space-y-3">
              {renderIssues(standardResult.securityIssues)}
            </TabsContent>
            <TabsContent value="suggestions" className="mt-6 space-y-3">
              {renderIssues(standardResult.suggestions)}
            </TabsContent>
          </Tabs>
        )}

        {uploadedFile?.content && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-white mb-4">
              Uploaded file preview
            </h3>
            <CodePreview
              code={uploadedFile.content}
              language={
                job.type === "compose" || job.type === "project"
                  ? "yaml"
                  : "docker"
              }
              highlightedLines={highlightedLines}
              maxHeight="500px"
            />
          </div>
        )}
      </div>
      </MotionPage>
    </Layout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Project-specific results section
// ─────────────────────────────────────────────────────────────────────────────

// FileResultCard is replaced by FileAnalysisDetail from components/FileAnalysisDetail.tsx

function ServiceMappingCard({ mapping }: { mapping: ServiceBuildMapping }) {
  return (
    <div className={`p-3 rounded-lg border text-sm ${
      mapping.issues.length === 0 ? "border-green-800/50 bg-green-950/10" : "border-amber-800/50 bg-amber-950/10"
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="font-medium text-white">{mapping.service}</span>
        {mapping.can_build && <Badge className="text-xs bg-blue-900/40 text-blue-300 border-blue-700/50">can build</Badge>}
        {mapping.can_run && <Badge className="text-xs bg-green-900/40 text-green-300 border-green-700/50">can run</Badge>}
      </div>
      {mapping.resolved_dockerfile && (
        <p className="text-xs text-slate-400 font-mono truncate">{mapping.resolved_dockerfile}</p>
      )}
      {mapping.issues.map((iss, i) => (
        <p key={i} className="text-xs text-amber-300 mt-1 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{iss}
        </p>
      ))}
    </div>
  );
}

function RunnabilityDetailCard({
  title,
  runnability,
  noMetadataReason = "No runnability metadata found.",
}: {
  title: string;
  runnability?: RunnabilityMeta;
  noMetadataReason?: string;
}) {
  const isRunnable = runnability?.runnable === true;
  return (
    <Card className="p-5 bg-slate-900 border-slate-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
          <p className="text-sm text-slate-400">
            Strict precheck rules decide whether the stack can be deployed.
          </p>
        </div>
        <Badge
          className={
            isRunnable
              ? "bg-green-500/20 text-green-400 border-green-500/30"
              : "bg-amber-500/20 text-amber-400 border-amber-500/30"
          }
        >
          {isRunnable ? "Runnable" : "Blocked"}
        </Badge>
      </div>
      {!isRunnable && (
        <ul className="mt-4 space-y-2 text-sm text-slate-300 list-disc list-inside">
          {(runnability?.reasons ?? [noMetadataReason]).map((reason, idx) => (
            <li key={idx}>{reason}</li>
          ))}
        </ul>
      )}
      {runnability?.rules && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-slate-400">
            Inspect runnability rules
          </summary>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {Object.entries(runnability.rules).map(([rule, passed]) => (
              <div
                key={rule}
                className={`flex items-center gap-2 p-2 rounded border ${
                  passed
                    ? "border-green-500/30 bg-green-500/5 text-green-300"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-300"
                }`}
              >
                <span className="font-mono truncate">{rule}</span>
                <span className="ml-auto">{passed ? "pass" : "fail"}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Image Build Section
// ─────────────────────────────────────────────────────────────────────────────

function ImageBuildSection({ builds }: { builds: ImageBuildResult[] }) {
  if (builds.length === 0) {
    return (
      <Card className="p-8 bg-slate-900 border-slate-800 text-center">
        <p className="text-slate-400 text-sm">
          No image build data available. Images are built automatically — check that the project contains valid Dockerfiles.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {builds.map((b, i) => (
        <ImageBuildCard key={i} build={b} />
      ))}
    </div>
  );
}

function ImageBuildCard({ build }: { build: ImageBuildResult }) {
  const [showLogs, setShowLogs] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  const statusBadge = build.status === "success"
    ? "bg-green-500/20 text-green-400 border-green-500/30"
    : build.status === "failed"
      ? "bg-red-500/20 text-red-400 border-red-500/30"
      : "bg-slate-500/20 text-slate-400 border-slate-500/30";

  const durationSec = build.build_duration_ms != null
    ? `${(build.build_duration_ms / 1000).toFixed(1)}s`
    : null;

  const shortId = build.image_id ? build.image_id.slice(0, 12) : null;

  return (
    <Card className="bg-slate-900 border-slate-800 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge className={`text-xs ${statusBadge}`}>{build.status.toUpperCase()}</Badge>
              <span className="font-mono text-sm text-white truncate">{build.dockerfile_path}</span>
            </div>
            <div className="text-xs text-slate-500 font-mono truncate">{build.image_tag}</div>
          </div>
          {durationSec && (
            <div className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
              <Clock className="w-3.5 h-3.5" />
              {durationSec}
            </div>
          )}
        </div>

        {build.status === "failed" && build.error_message && (
          <div className="p-3 rounded bg-red-950/30 border border-red-800/50 text-xs text-red-300 mb-3 font-mono">
            {build.error_message}
          </div>
        )}

        {build.status === "success" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
            {shortId && (
              <div className="p-2 bg-slate-950 rounded border border-slate-800">
                <div className="text-slate-500">Image ID</div>
                <div className="text-slate-200 font-mono">{shortId}</div>
              </div>
            )}
            {build.image_size_human && (
              <div className="p-2 bg-slate-950 rounded border border-slate-800 flex items-center gap-2">
                <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                <div>
                  <div className="text-slate-500">Size</div>
                  <div className="text-slate-200">{build.image_size_human}</div>
                </div>
              </div>
            )}
            {build.layer_count != null && (
              <div className="p-2 bg-slate-950 rounded border border-slate-800 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <div>
                  <div className="text-slate-500">Layers</div>
                  <div className="text-slate-200">{build.layer_count}</div>
                </div>
              </div>
            )}
            {build.architecture && (
              <div className="p-2 bg-slate-950 rounded border border-slate-800 flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                <div>
                  <div className="text-slate-500">Arch</div>
                  <div className="text-slate-200">{build.architecture}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {build.status === "success" && (
          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            {build.user && <span>User: <span className="text-slate-300 font-mono">{build.user}</span></span>}
            {build.workdir && <span>Workdir: <span className="text-slate-300 font-mono">{build.workdir}</span></span>}
            {(build.exposed_ports ?? []).length > 0 && (
              <span>Ports: <span className="text-slate-300 font-mono">{build.exposed_ports!.join(", ")}</span></span>
            )}
            {(build.entrypoint ?? []).length > 0 && (
              <span>Entrypoint: <span className="text-slate-300 font-mono">{(build.entrypoint!).join(" ")}</span></span>
            )}
            {(build.cmd ?? []).length > 0 && (
              <span>CMD: <span className="text-slate-300 font-mono">{(build.cmd!).join(" ")}</span></span>
            )}
          </div>
        )}
      </div>

      {/* Build logs */}
      {(build.build_logs ?? []).length > 0 && (
        <div className="border-t border-slate-800">
          <button
            onClick={() => setShowLogs(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
          >
            <Terminal className="w-3.5 h-3.5" />
            Build logs ({build.build_logs!.length} lines)
            {showLogs ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
          </button>
          {showLogs && (
            <div className="px-4 pb-4 max-h-64 overflow-y-auto">
              <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap leading-relaxed">
                {build.build_logs!.join("\n")}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Raw metadata */}
      {build.status === "success" && (
        <div className="border-t border-slate-800">
          <button
            onClick={() => setShowMeta(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
            Raw image metadata
            {showMeta ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
          </button>
          {showMeta && (
            <div className="px-4 pb-4 max-h-64 overflow-y-auto">
              <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap">
                {JSON.stringify(
                  { image_id: build.image_id, architecture: build.architecture, os: build.os, created_at: build.created_at, repo_tags: build.repo_tags, labels: build.labels, env_keys: build.env_keys },
                  null,
                  2,
                )}
              </pre>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

interface ProjectResultsSectionProps {
  result: ProjectAnalysisResult;
  job: Job;
  deployComposePath: string | null;
  onPrimaryComposeChange?: (composePath: string) => void;
}

function ProjectResultsSection({ result, job, deployComposePath, onPrimaryComposeChange }: ProjectResultsSectionProps) {
  const perFileResults = result.per_file_results ?? [];
  const serviceMappings = result.service_mappings ?? [];
  const projectSummary = result.project_summary;
  const recommendations = result.project_recommendations ?? [];
  const imageBuildResults = result.image_build_results ?? [];

  const dfResults = perFileResults.filter(r => r.file_type === "dockerfile");
  const cfResults = perFileResults.filter(r => r.file_type === "compose");
  const composeRunnabilityEntries = composeRunnabilityEntriesFromProject(result);

  const stacks = (job.input_metadata?.stacks as string[] | undefined) ?? [];

  if (perFileResults.length === 0 && serviceMappings.length === 0 && !projectSummary) {
    return null;
  }

  return (
    <div className="space-y-6 mb-6">
      {/* Project summary card */}
      {projectSummary && (
        <Card className="p-5 bg-slate-900 border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-4">Project Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
              <div className="text-2xl font-bold text-white">{projectSummary.total_files_analyzed}</div>
              <div className="text-xs text-slate-400">Files analyzed</div>
            </div>
            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
              <div className="text-2xl font-bold text-red-400">{projectSummary.total_errors}</div>
              <div className="text-xs text-slate-400">Total errors</div>
            </div>
            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
              <div className="text-2xl font-bold text-yellow-400">{projectSummary.total_warnings}</div>
              <div className="text-xs text-slate-400">Total warnings</div>
            </div>
            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
              <div className="text-2xl font-bold text-orange-400">{projectSummary.total_security_issues}</div>
              <div className="text-xs text-slate-400">Security issues</div>
            </div>
          </div>
          {stacks.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {stacks.map(s => <Badge key={s} variant="secondary" className="bg-slate-800 text-slate-300 text-xs">{s}</Badge>)}
            </div>
          )}
          {projectSummary.best_score_file && (
            <p className="text-xs text-slate-500">Best: <span className="font-mono text-slate-300">{projectSummary.best_score_file}</span></p>
          )}
        </Card>
      )}

      {/* Compose file selector for deploy */}
      {composeRunnabilityEntries.length > 0 && (
        <Card className="p-5 bg-slate-900 border-slate-800">
          <h3 className="text-base font-semibold text-white mb-1">Select Compose File for Deploy</h3>
          <p className="text-xs text-slate-500 mb-4">
            Choose which Compose file to use when running the stack. Only runnable files can be deployed.
          </p>
          <div className="space-y-2">
            {composeRunnabilityEntries.map(({ filePath, runnability }) => {
              const isSelected = deployComposePath === filePath;
              return (
                <button
                  key={filePath}
                  type="button"
                  onClick={() => onPrimaryComposeChange?.(filePath)}
                  className={`w-full text-left p-3 rounded-lg border motion-safe:transition-colors ${
                    isSelected
                      ? "border-green-700 bg-green-900/20"
                      : runnability.runnable
                        ? "border-slate-700 bg-slate-950 hover:border-slate-600"
                        : "border-slate-800 bg-slate-950/50 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      isSelected ? "border-green-500 bg-green-500" : "border-slate-600"
                    }`}>
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="font-mono text-sm text-white truncate flex-1">{filePath}</span>
                    <Badge className={`text-xs shrink-0 ${
                      runnability.runnable
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : "bg-red-500/20 text-red-400 border-red-500/30"
                    }`}>
                      {runnability.runnable ? "Runnable" : "Not runnable"}
                    </Badge>
                  </div>
                  {!runnability.runnable && runnability.reasons.length > 0 && (
                    <div className="mt-2 pl-7 space-y-0.5">
                      {runnability.reasons.map((reason, i) => (
                        <p key={i} className="text-xs text-slate-500">{reason}</p>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* If multiple compose files exist but none have runnability data, show standard runnability cards */}
      {composeRunnabilityEntries.length === 0 && cfResults.length > 0 && (
        <Card className="p-4 bg-slate-900 border-slate-800">
          <p className="text-sm text-slate-400">No runnability data available for the analyzed Compose files.</p>
        </Card>
      )}

      {/* Per-file analysis tabs */}
      {perFileResults.length > 0 && (
        <div>
          <Tabs defaultValue="all-files">
            <TabsList className="bg-slate-900 border border-slate-800 mb-4">
              <TabsTrigger value="all-files">All Files ({perFileResults.length})</TabsTrigger>
              {dfResults.length > 0 && <TabsTrigger value="dockerfiles">Dockerfiles ({dfResults.length})</TabsTrigger>}
              {cfResults.length > 0 && <TabsTrigger value="compose">Compose ({cfResults.length})</TabsTrigger>}
              <TabsTrigger value="image-builds">
                Image Builds {imageBuildResults.length > 0 ? `(${imageBuildResults.length})` : ""}
              </TabsTrigger>
              {serviceMappings.length > 0 && <TabsTrigger value="mapping">Service Mapping</TabsTrigger>}
              {recommendations.length > 0 && <TabsTrigger value="recommendations">Recommendations</TabsTrigger>}
            </TabsList>

            <TabsContent value="all-files" className="space-y-3">
              {perFileResults.map(f => <FileAnalysisDetail key={f.file_path} file={f} />)}
            </TabsContent>

            {dfResults.length > 0 && (
              <TabsContent value="dockerfiles" className="space-y-3">
                {dfResults.map(f => <FileAnalysisDetail key={f.file_path} file={f} />)}
              </TabsContent>
            )}

            {cfResults.length > 0 && (
              <TabsContent value="compose" className="space-y-3">
                {cfResults.map(f => <FileAnalysisDetail key={f.file_path} file={f} />)}
              </TabsContent>
            )}

            <TabsContent value="image-builds">
              <ImageBuildSection builds={imageBuildResults} />
            </TabsContent>

            {serviceMappings.length > 0 && (
              <TabsContent value="mapping">
                <Card className="p-5 bg-slate-900 border-slate-800">
                  <h3 className="text-base font-semibold text-white mb-3">Compose → Dockerfile Mapping</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {serviceMappings.map(m => (
                      <ServiceMappingCard key={`${m.compose_file}:${m.service}`} mapping={m} />
                    ))}
                  </div>
                </Card>
              </TabsContent>
            )}

            {recommendations.length > 0 && (
              <TabsContent value="recommendations">
                <Card className="p-5 bg-slate-900 border-slate-800">
                  <h3 className="text-base font-semibold text-white mb-3">Project Recommendations</h3>
                  <ul className="space-y-2">
                    {recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </div>
      )}
    </div>
  );
}

function escapeMarkdownCell(value: string | number | undefined | null): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function issueTable(rows: Issue[]): string {
  if (rows.length === 0) return "_None_\n";
  const header =
    "| Line | Code | Severity | Message | Suggestion | Docs |\n" +
    "| --- | --- | --- | --- | --- | --- |\n";
  const body = rows
    .map(
      (issue) =>
        `| ${escapeMarkdownCell(issue.line)} | ${escapeMarkdownCell(issue.code)} | ${escapeMarkdownCell(issue.severity)} | ${escapeMarkdownCell(issue.message)} | ${escapeMarkdownCell(issue.suggestion ?? "")} | ${escapeMarkdownCell(issue.doc_url ?? "")} |`,
    )
    .join("\n");
  return `${header}${body}\n`;
}

function detectSourceLanguage(jobType: string, filename: string | null): string {
  if (jobType === "compose" || jobType === "project") return "yaml";
  const lower = (filename ?? "").toLowerCase();
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  return "dockerfile";
}

function buildMarkdownReport(
  job: Job,
  result: AnalysisResult | null,
  projectResult: ProjectAnalysisResult | null,
  uploadedFile: UploadedFile | null,
): string {
  const meta = (job.input_metadata ?? {}) as Record<string, unknown>;
  const filename =
    (meta.filename as string | undefined) ?? uploadedFile?.name ?? job.id;
  const sourceContent =
    (meta.dockerfile_content as string | undefined) ??
    (meta.compose_content as string | undefined) ??
    uploadedFile?.content ??
    "";
  const language = detectSourceLanguage(job.type, filename);

  const lines: string[] = [];
  lines.push(`# Analysis Report - ${filename}`);
  lines.push("");
  lines.push("## Metadata");
  lines.push("");
  lines.push(`- **Job ID:** \`${job.id}\``);
  lines.push(`- **Job Type:** \`${job.type}\``);
  lines.push(`- **Status:** \`${job.status}\``);

  if (projectResult) {
    lines.push(`- **Overall Score:** ${projectResult.overall_score ?? projectResult.score}`);
    lines.push(`- **Overall Grade:** ${projectResult.overall_grade ?? projectResult.grade}`);
    const ps = projectResult.project_summary;
    if (ps) {
      lines.push(`- **Files Analyzed:** ${ps.total_files_analyzed}`);
      lines.push(`- **Total Errors:** ${ps.total_errors}`);
      lines.push(`- **Total Warnings:** ${ps.total_warnings}`);
      lines.push(`- **Security Issues:** ${ps.total_security_issues}`);
      lines.push(`- **Suggestions:** ${ps.total_suggestions}`);
    }
  } else if (result) {
    const errors = result.errors ?? [];
    const warnings = result.warnings ?? [];
    const suggestions = result.suggestions ?? [];
    const security = result.securityIssues ?? [];
    lines.push(`- **Score:** ${result.score}`);
    lines.push(`- **Grade:** ${result.grade}`);
    lines.push(
      `- **Counts:** ${errors.length} errors, ${warnings.length} warnings, ${suggestions.length} suggestions, ${security.length} security`,
    );
  } else {
    lines.push("- **Result:** _not available_");
  }
  lines.push("");

  lines.push("## Source File");
  lines.push("");
  lines.push(`File: \`${filename}\``);
  lines.push("");
  if (sourceContent) {
    lines.push("```" + language);
    lines.push(sourceContent.replace(/```/g, "``\u200b`"));
    lines.push("```");
  } else {
    lines.push("_Source file content not embedded in this report._");
  }
  lines.push("");

  if (projectResult) {
    lines.push("## Per-File Results");
    lines.push("");
    for (const fileResult of projectResult.per_file_results ?? []) {
      lines.push(`### ${fileResult.file_path} (${fileResult.file_type})`);
      lines.push("");
      lines.push(`Score: **${fileResult.score}** | Grade: **${fileResult.grade}**`);
      lines.push("");
      const fileIssues: Issue[] = [
        ...(fileResult.errors ?? []),
        ...(fileResult.warnings ?? []),
        ...(fileResult.securityIssues ?? []),
        ...(fileResult.suggestions ?? []),
      ];
      if (fileIssues.length > 0) {
        lines.push(issueTable(fileIssues));
      } else {
        lines.push("_No issues found._");
        lines.push("");
      }
    }

    if ((projectResult.service_mappings ?? []).length > 0) {
      lines.push("## Service Mappings");
      lines.push("");
      for (const m of projectResult.service_mappings) {
        lines.push(`- **${m.service}** (${m.compose_file}) — can_build: ${m.can_build}, can_run: ${m.can_run}`);
        for (const issue of m.issues) {
          lines.push(`  - ${issue}`);
        }
      }
      lines.push("");
    }

    if ((projectResult.image_build_results ?? []).length > 0) {
      lines.push("## Image Build Results");
      lines.push("");
      for (const b of projectResult.image_build_results!) {
        lines.push(`### ${b.dockerfile_path}`);
        lines.push("");
        lines.push(`- **Status:** ${b.status}`);
        lines.push(`- **Image Tag:** \`${b.image_tag}\``);
        if (b.image_id) lines.push(`- **Image ID:** \`${b.image_id}\``);
        if (b.image_size_human) lines.push(`- **Size:** ${b.image_size_human}`);
        if (b.layer_count != null) lines.push(`- **Layers:** ${b.layer_count}`);
        if (b.build_duration_ms != null) lines.push(`- **Build time:** ${(b.build_duration_ms / 1000).toFixed(1)}s`);
        if (b.architecture) lines.push(`- **Arch:** ${b.architecture}/${b.os ?? ""}`);
        if (b.error_message) lines.push(`- **Error:** ${b.error_message}`);
        lines.push("");
      }
    }

    if ((projectResult.project_recommendations ?? []).length > 0) {
      lines.push("## Project Recommendations");
      lines.push("");
      for (const rec of projectResult.project_recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push("");
    }
  } else if (result) {
    const errors = result.errors ?? [];
    const warnings = result.warnings ?? [];
    const suggestions = result.suggestions ?? [];
    const security = result.securityIssues ?? [];
    const allIssues: Issue[] = [...errors, ...warnings, ...suggestions, ...security];

    lines.push("## Issues");
    lines.push("");
    lines.push("### Errors");
    lines.push("");
    lines.push(issueTable(errors));
    lines.push("### Warnings");
    lines.push("");
    lines.push(issueTable(warnings));
    lines.push("### Suggestions");
    lines.push("");
    lines.push(issueTable(suggestions));
    lines.push("### Security");
    lines.push("");
    lines.push(issueTable(security));

    lines.push("## LLM Prompt");
    lines.push("");
    lines.push(
      "Paste the following block into an LLM chat to get a fixed version of the file above.",
    );
    lines.push("");
    lines.push("```text");
    lines.push(
      `You are a Docker / container best-practices expert. Apply the following fixes to the ${language} source file shown in the "Source File" section above.`,
    );
    lines.push("");
    lines.push("Requirements:");
    lines.push("- Output ONLY the modified file contents in a single fenced code block.");
    lines.push("- Preserve unrelated formatting and comments where possible.");
    lines.push("- Resolve every issue listed below; if a fix is ambiguous, choose the safest production-ready option and add a brief comment.");
    lines.push("- Do not invent services, images, or environment variables that are not implied by the original file.");
    lines.push("");
    lines.push("Issues to fix:");
    if (allIssues.length === 0) {
      lines.push("- No issues were detected; return the source file unchanged.");
    } else {
      for (const issue of allIssues) {
        const docPart = issue.doc_url ? ` (docs: ${issue.doc_url})` : "";
        const suggestionPart = issue.suggestion ? ` Suggested fix: ${issue.suggestion}` : "";
        lines.push(
          `- [line ${issue.line}] [${issue.severity.toUpperCase()} ${issue.code}] ${issue.message}.${suggestionPart}${docPart}`,
        );
      }
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function renderIssues(issues: Issue[]) {
  if (issues.length === 0) {
    return (
      <Card className="p-8 bg-slate-900 border-slate-800 text-center">
        <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
        <p className="text-slate-400">No issues found in this category</p>
      </Card>
    );
  }
  return issues.map((issue, index) => (
    <IssueCardInline key={index} issue={issue} />
  ));
}

function IssueCardInline({ issue }: { issue: Issue }) {
  return (
    <Card className="p-4 bg-slate-900 border-slate-800">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-1">
          {issue.severity === "error" && (
            <div className="p-2 bg-red-500/10 rounded">
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
          )}
          {issue.severity === "warning" && (
            <div className="p-2 bg-yellow-500/10 rounded">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
            </div>
          )}
          {issue.severity === "info" && (
            <div className="p-2 bg-blue-500/10 rounded">
              <Info className="w-5 h-5 text-blue-400" />
            </div>
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="border-slate-700 text-slate-400">Line {issue.line}</Badge>
            <Badge variant="outline" className="border-slate-700 text-slate-400 font-mono text-xs">{issue.code}</Badge>
            <Badge className={
              issue.severity === "error"
                ? "bg-red-500/20 text-red-400 border-red-500/30"
                : issue.severity === "warning"
                  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                  : "bg-blue-500/20 text-blue-400 border-blue-500/30"
            }>
              {issue.severity.toUpperCase()}
            </Badge>
          </div>
          <h4 className="text-white font-medium mb-2">{issue.message}</h4>
          {(issue.suggestion || issue.doc_url) && (
            <div className="bg-slate-950 border border-slate-800 rounded p-3 mt-3">
              <div className="text-sm text-green-400 mb-1">Recommended Fix</div>
              {issue.suggestion && <p className="text-sm text-slate-300">{issue.suggestion}</p>}
              {issue.doc_url && (
                <a href={issue.doc_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex text-sm text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline mt-2">
                  Rule documentation
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
