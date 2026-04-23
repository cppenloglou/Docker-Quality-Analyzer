import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { FileCode, Clock, ChevronRight, Trash2, FileText } from "lucide-react";
import { getHistory, type Job } from "../utils/api";

interface HistoryItem {
  id: string;
  fileName: string;
  fileType: "dockerfile" | "docker-compose";
  timestamp: Date;
  score: number;
  grade: string;
  errors: number;
  warnings: number;
  securityIssues: number;
}

export function History() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    getHistory()
      .then(setJobs)
      .catch(() => setJobs([]));
  }, []);

  const historyItems = useMemo<HistoryItem[]>(
    () =>
      jobs.map((job) => {
        const result = (job.result || {}) as {
          score?: number;
          grade?: string;
          errors?: unknown[];
          warnings?: unknown[];
          securityIssues?: unknown[];
        };
        return {
          id: job.id,
          fileName: String(job.input_metadata.filename || `${job.type}.yml`),
          fileType: job.type === "compose" ? "docker-compose" : "dockerfile",
          timestamp: new Date(job.created_at),
          score: result.score || 0,
          grade: result.grade || "F",
          errors: result.errors?.length || 0,
          warnings: result.warnings?.length || 0,
          securityIssues: result.securityIssues?.length || 0,
        };
      }),
    [jobs],
  );

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 60) return "text-yellow-400";
    return "text-red-400";
  };

  const getGradeColor = (grade: string) => {
    if (grade === "A")
      return "bg-green-500/20 text-green-400 border-green-500/30";
    if (grade === "B")
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    return "bg-red-500/20 text-red-400 border-red-500/30";
  };

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diffInHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60),
    );

    if (diffInHours < 24) {
      return `${diffInHours} hours ago`;
    } else if (diffInHours < 48) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Analysis History
          </h1>
          <p className="text-slate-400">
            Review your previous Docker file analyses
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="p-4 bg-slate-900 border-slate-800">
            <div className="text-2xl font-bold text-white">
              {historyItems.length}
            </div>
            <div className="text-sm text-slate-400">Total Analyses</div>
          </Card>

          <Card className="p-4 bg-slate-900 border-slate-800">
            <div className="text-2xl font-bold text-green-400">
              {historyItems.filter((item) => item.score >= 80).length}
            </div>
            <div className="text-sm text-slate-400">Grade A Files</div>
          </Card>

          <Card className="p-4 bg-slate-900 border-slate-800">
            <div className="text-2xl font-bold text-white">
              {Math.round(
                historyItems.reduce((sum, item) => sum + item.score, 0) /
                  historyItems.length,
              )}
            </div>
            <div className="text-sm text-slate-400">Average Score</div>
          </Card>

          <Card className="p-4 bg-slate-900 border-slate-800">
            <div className="text-2xl font-bold text-blue-400">
              {
                historyItems.filter(
                  (item) => item.fileType === "docker-compose",
                ).length
              }
            </div>
            <div className="text-sm text-slate-400">Compose Files</div>
          </Card>
        </div>

        {/* History List */}
        <div className="space-y-3">
          {historyItems.map((item) => (
            <Card
              key={item.id}
              className="p-5 bg-slate-900 border-slate-800 hover:border-slate-700 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-4 flex-1">
                  {/* Icon */}
                  <div className="p-3 bg-blue-500/10 rounded-lg">
                    {item.fileType === "docker-compose" ? (
                      <FileText className="w-5 h-5 text-blue-400" />
                    ) : (
                      <FileCode className="w-5 h-5 text-blue-400" />
                    )}
                  </div>

                  {/* File Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-white">
                        {item.fileName}
                      </h3>
                      <Badge className="bg-slate-800 text-slate-300 border-slate-700">
                        {item.fileType === "docker-compose"
                          ? "Docker Compose"
                          : "Dockerfile"}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1 text-slate-400">
                        <Clock className="w-4 h-4" />
                        {formatTimestamp(item.timestamp)}
                      </div>

                      {item.errors > 0 && (
                        <div className="flex items-center gap-1 text-red-400">
                          <span>{item.errors} errors</span>
                        </div>
                      )}

                      {item.warnings > 0 && (
                        <div className="flex items-center gap-1 text-yellow-400">
                          <span>{item.warnings} warnings</span>
                        </div>
                      )}

                      {item.securityIssues > 0 && (
                        <div className="flex items-center gap-1 text-orange-400">
                          <span>{item.securityIssues} security</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Score */}
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div
                        className={`text-3xl font-bold ${getScoreColor(item.score)}`}
                      >
                        {item.score}
                      </div>
                      <Badge
                        className={`${getGradeColor(item.grade)} px-3 py-1 mt-1`}
                      >
                        Grade {item.grade}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-6">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-slate-400 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-slate-400 group-hover:text-white"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Empty State (commented out since we have data) */}
        {historyItems.length === 0 && (
          <Card className="p-12 bg-slate-900 border-slate-800 text-center">
            <FileCode className="w-16 h-16 text-slate-700 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">
              No Analysis History
            </h3>
            <p className="text-slate-400 mb-6">
              Upload your first Docker file to get started
            </p>
            <Button
              onClick={() => navigate("/")}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Upload File
            </Button>
          </Card>
        )}
      </div>
    </Layout>
  );
}
