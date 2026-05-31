import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";

import { Layout } from "../components/Layout";
import { MotionPage } from "../components/motion";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ApiError, jobs as jobsApi, type Job } from "../utils/api";

interface BatchStoredItem {
  filename: string;
  job_id: string;
  status: string;
}

interface BatchStoredState {
  kind: "dockerfile" | "docker-compose";
  submitted_at: string;
  items: BatchStoredItem[];
}

interface BatchProgressRow {
  filename: string;
  job_id: string;
  status: Job["status"] | "queued" | "running" | "done" | "failed";
  score: number | null;
  grade: string | null;
  error: string | null;
}

function statusBadge(status: BatchProgressRow["status"]): string {
  switch (status) {
    case "done":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "failed":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case "running":
      return "bg-sky-500/15 text-sky-300 border-sky-500/30";
    default:
      return "bg-slate-700/40 text-slate-300 border-slate-600";
  }
}

function isTerminal(status: BatchProgressRow["status"]): boolean {
  return status === "done" || status === "failed";
}

export function BatchAnalysisProgress() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BatchProgressRow[]>([]);
  const [kind, setKind] = useState<BatchStoredState["kind"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refreshRows = async (baseRows: BatchProgressRow[]) => {
    const nextRows = await Promise.all(
      baseRows.map(async (row) => {
        try {
          const job = await jobsApi.get(row.job_id);
          const result =
            job.result && typeof job.result === "object"
              ? (job.result as Record<string, unknown>)
              : null;
          const message =
            result && typeof result.message === "string" ? result.message : null;
          const scoreValue = result && typeof result.score === "number" ? result.score : null;
          const gradeValue = result && typeof result.grade === "string" ? result.grade : null;
          return {
            ...row,
            status: job.status,
            score: scoreValue,
            grade: gradeValue,
            error: message,
          };
        } catch (err) {
          const message =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Unable to fetch latest job status.";
          return {
            ...row,
            error: message,
          };
        }
      }),
    );
    setRows(nextRows);
    return nextRows;
  };

  useEffect(() => {
    const raw = sessionStorage.getItem("batchAnalysis");
    if (!raw) {
      navigate("/");
      return;
    }
    let parsed: BatchStoredState;
    try {
      parsed = JSON.parse(raw) as BatchStoredState;
    } catch {
      navigate("/");
      return;
    }
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      navigate("/");
      return;
    }
    const initialRows: BatchProgressRow[] = parsed.items.map((item) => ({
      filename: item.filename,
      job_id: item.job_id,
      status:
        item.status === "running" || item.status === "done" || item.status === "failed"
          ? item.status
          : "queued",
      score: null,
      grade: null,
      error: null,
    }));
    setKind(parsed.kind);
    setRows(initialRows);
    setLoading(false);
    void refreshRows(initialRows);
  }, [navigate]);

  useEffect(() => {
    if (!rows.length) return;
    if (rows.every((row) => isTerminal(row.status))) return;
    const timer = window.setInterval(() => {
      setRefreshing(true);
      void refreshRows(rows).finally(() => setRefreshing(false));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [rows]);

  const stats = useMemo(() => {
    const done = rows.filter((row) => row.status === "done").length;
    const failed = rows.filter((row) => row.status === "failed").length;
    const running = rows.length - done - failed;
    return { done, failed, running, total: rows.length };
  }, [rows]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshRows(rows);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="mx-auto max-w-4xl">
          <Card className="border-slate-800 bg-slate-900 p-6 text-slate-300">
            Loading batch analysis...
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <MotionPage>
        <div className="mx-auto max-w-5xl space-y-6">
          <Card className="border-slate-800 bg-slate-900 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Batch analysis
                </p>
                <h1 className="text-2xl font-bold text-white">
                  Tracking {stats.total} {kind === "docker-compose" ? "Compose" : "Dockerfile"} files
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Done: {stats.done} | Failed: {stats.failed} | In progress: {stats.running}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                  onClick={() => void handleRefresh()}
                  disabled={refreshing}
                >
                  {refreshing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                  onClick={() => navigate("/history")}
                >
                  Open History
                </Button>
              </div>
            </div>
          </Card>

          <div className="space-y-3">
            {rows.map((row) => (
              <Card key={row.job_id} className="border-slate-800 bg-slate-900 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-slate-200">{row.filename}</p>
                    <p className="mt-1 font-mono text-xs text-slate-500">{row.job_id}</p>
                    {row.error ? (
                      <p className="mt-1 text-xs text-red-300">{row.error}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={`border ${statusBadge(row.status)}`}>{row.status}</Badge>
                    {row.score != null ? (
                      <Badge className="border-slate-700 bg-slate-800 text-slate-200">
                        Score {row.score}
                        {row.grade ? ` (${row.grade})` : ""}
                      </Badge>
                    ) : null}
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700"
                      disabled={row.status !== "done"}
                      onClick={() => navigate(`/results?jobId=${row.job_id}`)}
                    >
                      View Result
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </MotionPage>
    </Layout>
  );
}
