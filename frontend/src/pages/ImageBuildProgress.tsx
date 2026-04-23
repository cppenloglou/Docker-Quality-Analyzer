import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { Card } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Package, CheckCircle2, Loader2, Terminal } from "lucide-react";
import { MOCK_BUILD_LOGS } from "../utils/mockData";
import { getJob } from "../utils/api";

export function ImageBuildProgress() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [buildComplete, setBuildComplete] = useState(false);

  useEffect(() => {
    const jobId = sessionStorage.getItem("analysisJobId") || sessionStorage.getItem("projectJobId");
    if (!jobId) {
      navigate("/project-upload");
      return;
    }

    let cancelled = false;
    getJob(jobId)
      .then((job) => {
        if (cancelled) return;
        if (job.result) {
          sessionStorage.setItem("analysisResults", JSON.stringify(job.result));
        }
      })
      .catch(() => undefined);

    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= MOCK_BUILD_LOGS.length - 1) {
          clearInterval(interval);
          setBuildComplete(true);
          return prev;
        }
        return prev + 1;
      });
    }, 800);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [navigate]);

  const logs = useMemo(
    () =>
      MOCK_BUILD_LOGS.map((log: (typeof MOCK_BUILD_LOGS)[0], index: number) => {
        if (index < currentStep) {
          return { ...log, status: "completed" as const };
        }
        if (index === currentStep) {
          return { ...log, status: "in-progress" as const };
        }
        return log;
      }),
    [currentStep],
  );
  const progress = (currentStep / MOCK_BUILD_LOGS.length) * 100;

  const handleViewImageAnalysis = () => {
    navigate("/image-analysis");
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`p-2 rounded-lg ${buildComplete ? "bg-green-500/10" : "bg-blue-500/10"}`}
            >
              {buildComplete ? (
                <CheckCircle2 className="w-6 h-6 text-green-400" />
              ) : (
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
              )}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">
                {buildComplete ? "Build Complete" : "Building Docker Image"}
              </h1>
              <p className="text-slate-400 mt-1">
                {buildComplete
                  ? "Your Docker image has been built successfully"
                  : "Building image from your project files..."}
              </p>
            </div>
          </div>
        </div>

        {/* Progress Overview */}
        <Card className="p-6 bg-slate-900 border-slate-800 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Package className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-white">
                Build Progress
              </h2>
            </div>
            <Badge
              className={
                buildComplete
                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                  : "bg-blue-500/20 text-blue-400 border-blue-500/30"
              }
            >
              {buildComplete
                ? "Completed"
                : `Step ${currentStep + 1}/${MOCK_BUILD_LOGS.length}`}
            </Badge>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-400">Overall Progress</span>
              <span className="text-white font-medium">
                {Math.round(progress)}%
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {buildComplete && (
            <div className="mt-6 p-4 bg-green-500/5 border border-green-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5" />
                <div>
                  <p className="text-white font-medium">
                    Image built successfully
                  </p>
                  <p className="text-sm text-slate-400 mt-1">
                    Image ID:{" "}
                    <span className="text-blue-400 font-mono">
                      sha256:4d9e1a2c5b
                    </span>
                  </p>
                  <p className="text-sm text-slate-400">
                    Total size: <span className="text-white">163.5 MB</span>
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Build Logs Terminal */}
        <Card className="bg-slate-950 border-slate-800">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-white">Build Logs</h3>
            </div>
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
              <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
            </div>
          </div>

          <div className="p-6 font-mono text-sm max-h-[500px] overflow-y-auto">
            {logs.map((log, index) => (
              <div
                key={index}
                className={`py-1 flex items-start gap-3 ${
                  log.status === "completed"
                    ? "text-slate-400"
                    : log.status === "in-progress"
                      ? "text-blue-400"
                      : "text-slate-600"
                }`}
              >
                <div className="flex items-center gap-2 min-w-[120px]">
                  {log.status === "completed" && (
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  )}
                  {log.status === "in-progress" && (
                    <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                  )}
                  {log.status === "pending" && (
                    <div className="w-4 h-4 rounded-full border-2 border-slate-700" />
                  )}
                  <span className="text-slate-500">Step {log.step}</span>
                </div>
                <span className="flex-1">{log.message}</span>
              </div>
            ))}

            {buildComplete && (
              <div className="py-2 flex items-start gap-3 text-green-400 mt-4">
                <CheckCircle2 className="w-4 h-4 mt-1" />
                <div>
                  <div>Successfully built sha256:4d9e1a2c5b</div>
                  <div>Successfully tagged my-node-app:latest</div>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Action Buttons */}
        {buildComplete && (
          <div className="flex gap-4 mt-6">
            <Button
              onClick={() => navigate("/project-upload")}
              variant="outline"
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Build Another Image
            </Button>
            <Button
              onClick={handleViewImageAnalysis}
              className="bg-blue-600 hover:bg-blue-700"
            >
              View Image Analysis
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
