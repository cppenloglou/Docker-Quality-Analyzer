import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  ChevronRight,
  Clock,
  FileCode,
  FileText,
  FolderArchive,
} from "lucide-react";

import { DockerLoader, useMinLoader } from "../components/DockerLoader";
import { Layout } from "../components/Layout";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ApiError, compose as composeApi, jobs as jobsApi, type Job } from "../utils/api";
import { MotionPage, StaggerList, StaggerItem, MotionCard } from "../components/motion";

interface HistoryItem {
  id: string;
  fileName: string;
  jobType: Job["type"];
  status: Job["status"];
  timestamp: Date;
  score: number | null;
  grade: string | null;
  errors: number;
  warnings: number;
  securityIssues: number;
}

function scoreColor(score: number | null) {
  if (score == null) return "text-slate-400";
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  return "text-red-400";
}

function gradeColor(grade: string | null) {
  if (!grade) return "bg-slate-800 text-slate-300 border-slate-700";
  if (grade === "A") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (grade === "B") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

function statusColor(status: Job["status"]) {
  switch (status) {
    case "done":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    case "running":
      return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "queued":
      return "bg-slate-700/40 text-slate-300 border-slate-600";
    case "failed":
      return "bg-red-500/20 text-red-300 border-red-500/30";
  }
}

function formatTimestamp(date: Date) {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffHours < 48) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function History() {
  const navigate = useNavigate();
  const [jobList, setJobList] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const ready = useMinLoader(!loading);
  const [error, setError] = useState<string | null>(null);
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
  const jobListRef = useRef<Job[]>([]);

  const pollRunningStatus = useCallback(async (jobs: Job[]) => {
    const composeJobs = jobs.filter(
      (j) => (j.type === "compose" || j.type === "project") && j.status === "done",
    );
    if (composeJobs.length === 0) return;
    const activeIds = new Set<string>();
    await Promise.all(
      composeJobs.map(async (j) => {
        try {
          const status = await composeApi.deployStatus(j.id);
          if (status.active) activeIds.add(j.id);
        } catch { /* ignore */ }
      }),
    );
    setRunningJobs(activeIds);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await jobsApi.history();
        if (!cancelled) {
          setJobList(data);
          jobListRef.current = data;
          await pollRunningStatus(data);
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load history.";
        setError(message);
        toast.error(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pollRunningStatus]);

  useEffect(() => {
    if (jobList.length === 0) return;
    const interval = setInterval(() => {
      pollRunningStatus(jobListRef.current);
    }, 5000);
    return () => clearInterval(interval);
  }, [jobList, pollRunningStatus]);

  const historyItems = useMemo<HistoryItem[]>(
    () =>
      jobList.map((job) => {
        const result = (job.result ?? {}) as {
          score?: number;
          grade?: string;
          errors?: unknown[];
          warnings?: unknown[];
          securityIssues?: unknown[];
        };
        const fileName =
          (job.input_metadata?.filename as string | undefined) ??
          `${job.type}-${job.id.slice(0, 6)}`;
        return {
          id: job.id,
          fileName,
          jobType: job.type,
          status: job.status,
          timestamp: new Date(job.created_at),
          score: typeof result.score === "number" ? result.score : null,
          grade: typeof result.grade === "string" ? result.grade : null,
          errors: Array.isArray(result.errors) ? result.errors.length : 0,
          warnings: Array.isArray(result.warnings) ? result.warnings.length : 0,
          securityIssues: Array.isArray(result.securityIssues)
            ? result.securityIssues.length
            : 0,
        };
      }),
    [jobList],
  );

  const averageScore = useMemo(() => {
    const scored = historyItems.filter(
      (item): item is HistoryItem & { score: number } =>
        typeof item.score === "number",
    );
    if (scored.length === 0) return null;
    const total = scored.reduce((sum, item) => sum + item.score, 0);
    return Math.round(total / scored.length);
  }, [historyItems]);

  const openJob = (item: HistoryItem) => {
    if (item.status === "done") {
      navigate(`/results?jobId=${item.id}`);
    } else if (item.status === "failed") {
      navigate(`/results?jobId=${item.id}`);
    } else {
      navigate(`/analysis?jobId=${item.id}`);
    }
  };

  return (
    <Layout>
      <MotionPage>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Analysis History
          </h1>
          <p className="text-slate-400">
            All analysis jobs scoped to your account.
          </p>
        </div>

        <StaggerList className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StaggerItem>
          <Card className="p-4 bg-slate-900 border-slate-800">
            <div className="text-2xl font-bold text-white">
              {historyItems.length}
            </div>
            <div className="text-sm text-slate-400">Total jobs</div>
          </Card>
          </StaggerItem>
          <StaggerItem>
          <Card className="p-4 bg-slate-900 border-slate-800">
            <div className="text-2xl font-bold text-green-400">
              {historyItems.filter((item) => (item.score ?? 0) >= 80).length}
            </div>
            <div className="text-sm text-slate-400">Grade A</div>
          </Card>
          </StaggerItem>
          <StaggerItem>
          <Card className="p-4 bg-slate-900 border-slate-800">
            <div className="text-2xl font-bold text-white">
              {averageScore ?? "-"}
            </div>
            <div className="text-sm text-slate-400">Average score</div>
          </Card>
          </StaggerItem>
          <StaggerItem>
          <Card className="p-4 bg-slate-900 border-slate-800">
            <div className="text-2xl font-bold text-blue-400">
              {historyItems.filter((item) => item.jobType === "compose").length}
            </div>
            <div className="text-sm text-slate-400">Compose jobs</div>
          </Card>
          </StaggerItem>
        </StaggerList>

        {!ready && (
          <DockerLoader message="Loading your job history..." fullScreen={false} />
        )}

        {ready && error && (
          <Card className="p-6 bg-red-950/20 border-red-800 text-red-300 mb-6">
            {error}
          </Card>
        )}

        {ready && !error && historyItems.length === 0 && (
          <Card className="p-12 bg-slate-900 border-slate-800 text-center">
            <FileCode className="w-16 h-16 text-slate-700 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">
              No analysis history yet
            </h3>
            <p className="text-slate-400 mb-6">
              Upload your first Docker configuration to get started.
            </p>
            <Button
              onClick={() => navigate("/")}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Upload File
            </Button>
          </Card>
        )}

        {ready && historyItems.length > 0 && (
          <StaggerList className="space-y-3">
            {historyItems.map((item) => (
              <StaggerItem key={item.id}>
              <MotionCard
                noHover
                className="rounded-xl"
              >
              <Card
                onClick={() => openJob(item)}
                className="p-5 bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer group"
              >
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="p-3 bg-blue-500/10 rounded-lg shrink-0">
                      {item.jobType === "compose" ? (
                        <FileText className="w-5 h-5 text-blue-400" />
                      ) : item.jobType === "project" ? (
                        <FolderArchive className="w-5 h-5 text-blue-400" />
                      ) : (
                        <FileCode className="w-5 h-5 text-blue-400" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="text-lg font-semibold text-white truncate">
                          {item.fileName}
                        </h3>
                        <Badge className="bg-slate-800 text-slate-300 border-slate-700">
                          {item.jobType}
                        </Badge>
                        <Badge className={statusColor(item.status)}>
                          {item.status}
                        </Badge>
                        {runningJobs.has(item.id) && (
                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            Containers Running
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-sm flex-wrap">
                        <div className="flex items-center gap-1 text-slate-400">
                          <Clock className="w-4 h-4" />
                          {formatTimestamp(item.timestamp)}
                        </div>
                        {item.errors > 0 && (
                          <span className="text-red-400">
                            {item.errors} errors
                          </span>
                        )}
                        {item.warnings > 0 && (
                          <span className="text-yellow-400">
                            {item.warnings} warnings
                          </span>
                        )}
                        {item.securityIssues > 0 && (
                          <span className="text-orange-400">
                            {item.securityIssues} security
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 ml-auto">
                    {item.score != null && (
                      <div className="text-right">
                        <div
                          className={`text-3xl font-bold ${scoreColor(item.score)}`}
                        >
                          {item.score}
                        </div>
                        {item.grade && (
                          <Badge className={`${gradeColor(item.grade)} px-3 py-1 mt-1`}>
                            Grade {item.grade}
                          </Badge>
                        )}
                      </div>
                    )}
                    <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-white" />
                  </div>
                </div>
              </Card>
              </MotionCard>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </div>
      </MotionPage>
    </Layout>
  );
}
