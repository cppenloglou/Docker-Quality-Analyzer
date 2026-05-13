import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  FileCode,
  FileText,
  HardDrive,
  Info,
  Layers,
  Loader2,
  Package,
  Play,
  Shield,
  Square,
} from "lucide-react";

import { DockerLoader, useMinLoader } from "../components/DockerLoader";
import { Layout } from "../components/Layout";
import { CodePreview } from "../components/CodePreview";
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
  type AnalysisResult,
  type Issue,
  type Job,
  type PerFileAnalysisResult,
  type ServiceBuildMapping,
  type ProjectSummary,
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
  const [containerStatus, setContainerStatus] = useState<"stopped" | "running" | "stopping">(() => {
    const stored = sessionStorage.getItem("dqa:containerStatus");
    if (stored === "stopping") return "stopping";
    return "stopped";
  });

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
    if (!job || (job.type !== "compose" && job.type !== "project")) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await composeApi.deployStatus(job.id);
        if (cancelled) return;
        if (!status.active) {
          setContainerStatus("stopped");
          sessionStorage.removeItem("dqa:containerStatus");
        } else if (containerStatus === "stopping") {
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            if (cancelled) return;
            try {
              const poll = await composeApi.deployStatus(job.id);
              if (!poll.active) {
                setContainerStatus("stopped");
                sessionStorage.removeItem("dqa:containerStatus");
                toast.success("Containers stopped");
                return;
              }
            } catch { break; }
          }
          setContainerStatus("stopped");
          sessionStorage.removeItem("dqa:containerStatus");
        } else {
          setContainerStatus("running");
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [job]);

  const result = useMemo<AnalysisResult | null>(() => {
    if (!job?.result) return null;
    return isAnalysisResult(job.result) ? job.result : null;
  }, [job]);

  const failureMessage = useMemo(() => {
    if (!job || isAnalysisResult(job.result)) return null;
    const r = job.result as { message?: string } | null;
    return r?.message ?? null;
  }, [job]);

  const highlightedLines = useMemo(() => {
    if (!result) return [] as number[];
    return [
      ...result.errors.map((e) => e.line),
      ...result.warnings.map((w) => w.line),
      ...result.securityIssues.map((s) => s.line),
    ];
  }, [result]);

  const isComposeJob = job?.type === "compose";
  const isProjectJob = job?.type === "project";
  const runnability = result?.meta?.runnability;
  const estimate = result?.meta?.estimate;
  const composeRunnable =
    (isComposeJob || isProjectJob) && runnability?.runnable === true;

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
    if (!job || containerStatus !== "running") return;
    setContainerStatus("stopping");
    sessionStorage.setItem("dqa:containerStatus", "stopping");
    pushNotification("info", "Stopping Containers", "Stop signal sent, waiting for shutdown...");
    try {
      await composeApi.stopDeploy({ job_id: job.id });
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const status = await composeApi.deployStatus(job.id);
          if (!status.active) {
            setContainerStatus("stopped");
            sessionStorage.removeItem("dqa:containerStatus");
            toast.success("Containers stopped");
            pushNotification("success", "Containers Stopped", "All containers have been successfully stopped");
            return;
          }
        } catch {
          break;
        }
      }
      setContainerStatus("stopped");
      sessionStorage.removeItem("dqa:containerStatus");
    } catch {
      setContainerStatus("running");
      sessionStorage.removeItem("dqa:containerStatus");
      toast.error("Failed to stop containers");
      pushNotification("error", "Stop Failed", "Failed to stop containers");
    }
  };

  const handleExport = () => {
    if (!job) return;
    const markdown = buildMarkdownReport(job, result, uploadedFile);
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

  if (!result) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto">
          <Card className="p-6 bg-slate-900 border-slate-800 text-slate-300">
            <p className="mb-4">
              Job {job.id} is {job.status}. Results are not yet available.
            </p>
            <Button onClick={() => navigate(`/analysis?jobId=${job.id}`)}>
              Watch progress
            </Button>
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
              {(isComposeJob || isProjectJob) && containerStatus === "stopped" && (
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
                  Run Containers
                </Button>
              )}
              {(isComposeJob || isProjectJob) && containerStatus === "running" && (
                <>
                  <Button
                    onClick={handleRunContainers}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    Inspect your Containers
                    <Loader2 className="w-3 h-3 ml-2 animate-spin" />
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
                <div className={`text-6xl font-bold ${scoreColor(result.score)}`}>
                  <AnimatedNumber value={result.score} />
                </div>
                <div className="text-slate-400 text-sm mt-1">Quality Score</div>
                {result.line_count && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    {result.line_count} lines analyzed
                  </div>
                )}
              </motion.div>
              <motion.div
                initial="initial"
                animate="animate"
                variants={reducedMotion ? undefined : badgePopVariants}
                transition={reducedMotion ? undefined : badgePopTransition}
              >
                <Badge className={`text-2xl px-4 py-2 ${gradeColor(result.grade)}`}>
                  Grade {result.grade}
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
                  {result.errors.length}
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
                  {result.warnings.length}
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
                  {result.securityIssues.length}
                </div>
                <div className="text-sm text-slate-400">Security</div>
              </div>
            </Card>
            </StaggerItem>
          </StaggerList>
        </Card>

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

        {(isComposeJob || isProjectJob) && (
          <Card className="p-5 bg-slate-900 border-slate-800 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">
                  Deploy Runnability
                </h3>
                <p className="text-sm text-slate-400">
                  Strict precheck rules decide whether the stack can be deployed.
                </p>
              </div>
              <Badge
                className={
                  composeRunnable
                    ? "bg-green-500/20 text-green-400 border-green-500/30"
                    : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                }
              >
                {composeRunnable ? "Runnable" : "Blocked"}
              </Badge>
            </div>
            {!composeRunnable && (
              <ul className="mt-4 space-y-2 text-sm text-slate-300 list-disc list-inside">
                {(runnability?.reasons ?? [
                  "No runnability metadata found.",
                ]).map((reason, idx) => (
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

        {isProjectJob && <ProjectResultsSection result={result} job={job} />}

        <Tabs defaultValue="all" className="mb-6">
          <TabsList className="bg-slate-900 border border-slate-800">
            <TabsTrigger value="all">All Issues</TabsTrigger>
            <TabsTrigger value="errors">
              Errors ({result.errors.length})
            </TabsTrigger>
            <TabsTrigger value="warnings">
              Warnings ({result.warnings.length})
            </TabsTrigger>
            <TabsTrigger value="security">
              Security ({result.securityIssues.length})
            </TabsTrigger>
            <TabsTrigger value="suggestions">
              Suggestions ({result.suggestions.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-6 space-y-3">
            {renderIssues([
              ...result.errors,
              ...result.warnings,
              ...result.securityIssues,
              ...result.suggestions,
            ])}
          </TabsContent>
          <TabsContent value="errors" className="mt-6 space-y-3">
            {renderIssues(result.errors)}
          </TabsContent>
          <TabsContent value="warnings" className="mt-6 space-y-3">
            {renderIssues(result.warnings)}
          </TabsContent>
          <TabsContent value="security" className="mt-6 space-y-3">
            {renderIssues(result.securityIssues)}
          </TabsContent>
          <TabsContent value="suggestions" className="mt-6 space-y-3">
            {renderIssues(result.suggestions)}
          </TabsContent>
        </Tabs>

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

function FileResultCard({ file }: { file: PerFileAnalysisResult }) {
  const [expanded, setExpanded] = useState(false);
  const allIssues = [
    ...(file.errors ?? []),
    ...(file.warnings ?? []),
    ...(file.securityIssues ?? []),
    ...(file.suggestions ?? []),
  ];
  return (
    <Card className="bg-slate-900 border-slate-800 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full p-4 flex items-center gap-3 text-left hover:bg-slate-800/50 motion-safe:transition-colors"
      >
        {file.file_type === "dockerfile" ? (
          <FileCode className="w-4 h-4 text-blue-400 shrink-0" />
        ) : (
          <FileText className="w-4 h-4 text-green-400 shrink-0" />
        )}
        <span className="flex-1 font-mono text-sm text-white truncate">{file.file_path}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-sm font-bold ${scoreColor(file.score)}`}>{file.score}</span>
          <Badge className={`text-xs ${gradeColor(file.grade)}`}>Grade {file.grade}</Badge>
          {file.errors_count > 0 && (
            <span className="text-xs text-red-400">{file.errors_count}E</span>
          )}
          {file.warnings_count > 0 && (
            <span className="text-xs text-yellow-400">{file.warnings_count}W</span>
          )}
          {file.security_count > 0 && (
            <span className="text-xs text-orange-400">{file.security_count}S</span>
          )}
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
        </div>
      </button>
      {expanded && allIssues.length > 0 && (
        <div className="border-t border-slate-800 p-4 space-y-2 max-h-72 overflow-y-auto">
          {allIssues.map((issue, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs p-2 rounded border ${
              issue.severity === "error" ? "border-red-800/50 bg-red-950/20" :
              issue.severity === "warning" ? "border-yellow-800/50 bg-yellow-950/20" :
              "border-slate-800 bg-slate-950/50"
            }`}>
              <span className={`font-mono shrink-0 ${
                issue.severity === "error" ? "text-red-400" :
                issue.severity === "warning" ? "text-yellow-400" :
                "text-slate-400"
              }`}>{issue.code}</span>
              <span className="text-slate-300 flex-1">{issue.message}</span>
              {issue.line && issue.line > 1 && (
                <span className="text-slate-600 shrink-0">L{issue.line}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {expanded && allIssues.length === 0 && (
        <div className="border-t border-slate-800 p-4 text-sm text-slate-500 italic">No issues found.</div>
      )}
    </Card>
  );
}

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

interface ProjectResultsSectionProps {
  result: AnalysisResult;
  job: Job;
}

function ProjectResultsSection({ result, job }: ProjectResultsSectionProps) {
  const raw = result as unknown as {
    per_file_results?: PerFileAnalysisResult[];
    service_mappings?: ServiceBuildMapping[];
    project_summary?: ProjectSummary;
    project_recommendations?: string[];
  };

  const perFileResults = raw.per_file_results ?? [];
  const serviceMappings = raw.service_mappings ?? [];
  const projectSummary = raw.project_summary;
  const recommendations = raw.project_recommendations ?? [];

  const dfResults = perFileResults.filter(r => r.file_type === "dockerfile");
  const cfResults = perFileResults.filter(r => r.file_type === "compose");

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

      {/* Per-file analysis tabs */}
      {perFileResults.length > 0 && (
        <div>
          <Tabs defaultValue="all-files">
            <TabsList className="bg-slate-900 border border-slate-800 mb-4">
              <TabsTrigger value="all-files">All Files ({perFileResults.length})</TabsTrigger>
              {dfResults.length > 0 && <TabsTrigger value="dockerfiles">Dockerfiles ({dfResults.length})</TabsTrigger>}
              {cfResults.length > 0 && <TabsTrigger value="compose">Compose ({cfResults.length})</TabsTrigger>}
              {serviceMappings.length > 0 && <TabsTrigger value="mapping">Service Mapping</TabsTrigger>}
              {recommendations.length > 0 && <TabsTrigger value="recommendations">Recommendations</TabsTrigger>}
            </TabsList>

            <TabsContent value="all-files" className="space-y-3">
              {perFileResults.map(f => <FileResultCard key={f.file_path} file={f} />)}
            </TabsContent>

            {dfResults.length > 0 && (
              <TabsContent value="dockerfiles" className="space-y-3">
                {dfResults.map(f => <FileResultCard key={f.file_path} file={f} />)}
              </TabsContent>
            )}

            {cfResults.length > 0 && (
              <TabsContent value="compose" className="space-y-3">
                {cfResults.map(f => <FileResultCard key={f.file_path} file={f} />)}
              </TabsContent>
            )}

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

  const errors = result?.errors ?? [];
  const warnings = result?.warnings ?? [];
  const suggestions = result?.suggestions ?? [];
  const security = result?.securityIssues ?? [];
  const allIssues: Issue[] = [...errors, ...warnings, ...suggestions, ...security];

  const lines: string[] = [];
  lines.push(`# Analysis Report - ${filename}`);
  lines.push("");
  lines.push("## Metadata");
  lines.push("");
  lines.push(`- **Job ID:** \`${job.id}\``);
  lines.push(`- **Job Type:** \`${job.type}\``);
  lines.push(`- **Status:** \`${job.status}\``);
  if (result) {
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

  if (result) {
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
  }

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
    <Card key={index} className="p-4 bg-slate-900 border-slate-800">
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
            <Badge
              variant="outline"
              className="border-slate-700 text-slate-400"
            >
              Line {issue.line}
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-700 text-slate-400 font-mono text-xs"
            >
              {issue.code}
            </Badge>
            <Badge
              className={
                issue.severity === "error"
                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                  : issue.severity === "warning"
                    ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                    : "bg-blue-500/20 text-blue-400 border-blue-500/30"
              }
            >
              {issue.severity.toUpperCase()}
            </Badge>
          </div>

          <h4 className="text-white font-medium mb-2">{issue.message}</h4>

          {(issue.suggestion || issue.doc_url) && (
            <div className="bg-slate-950 border border-slate-800 rounded p-3 mt-3">
              <div className="text-sm text-green-400 mb-1">Recommended Fix</div>
              {issue.suggestion ? (
                <p className="text-sm text-slate-300">{issue.suggestion}</p>
              ) : null}
              {issue.doc_url ? (
                <a
                  href={issue.doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-sm text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline mt-2"
                >
                  Rule documentation
                </a>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </Card>
  ));
}
