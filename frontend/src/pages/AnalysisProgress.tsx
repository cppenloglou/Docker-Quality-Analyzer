import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ProgressStep } from "../components/ProgressStep";
import { Card } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Button } from "../components/ui/button";
import { enqueueComposeAnalysis, enqueueDockerfileAnalysis, getJob } from "../utils/api";

type StepStatus = "pending" | "running" | "complete" | "error";

interface AnalysisStep {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
}

export function AnalysisProgress() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [steps, setSteps] = useState<AnalysisStep[]>([
    {
      id: "validate",
      label: "File Validation",
      description: "Checking file format and structure",
      status: "running",
    },
    {
      id: "syntax",
      label: "Syntax Check",
      description: "Validating Docker syntax",
      status: "pending",
    },
    {
      id: "security",
      label: "Security Linting",
      description: "Scanning for security vulnerabilities",
      status: "pending",
    },
    {
      id: "bestpractices",
      label: "Best Practice Analysis",
      description: "Checking against Docker best practices",
      status: "pending",
    },
    {
      id: "report",
      label: "Generating Report",
      description: "Compiling analysis results",
      status: "pending",
    },
  ]);

  useEffect(() => {
    let cancelled = false;

    const setStepStatus = (index: number, status: StepStatus) => {
      setSteps((prev) =>
        prev.map((step, idx) => (idx === index ? { ...step, status } : step)),
      );
    };

    const completeUpTo = (index: number) => {
      setSteps((prev) =>
        prev.map((step, idx) => {
          if (idx < index) return { ...step, status: "complete" as StepStatus };
          if (idx === index) return { ...step, status: "running" as StepStatus };
          return step;
        }),
      );
    };

    const runAnalysis = async () => {
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

      try {
        const file = new File([uploadedFile.content], uploadedFile.name, { type: "text/plain" });
        const enqueue =
          uploadedFile.type === "docker-compose"
            ? await enqueueComposeAnalysis(file)
            : await enqueueDockerfileAnalysis(file);

        completeUpTo(1);
        setProgress(25);
        let latest = await getJob(enqueue.job_id);
        let cycles = 0;
        while (!cancelled && latest.status !== "done" && latest.status !== "failed" && cycles < 120) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          cycles += 1;
          latest = await getJob(enqueue.job_id);
          setProgress(Math.min(95, 25 + cycles * 2));
          if (cycles > 3) {
            completeUpTo(2);
          }
          if (cycles > 10) {
            completeUpTo(3);
          }
        }

        if (latest.status !== "done") {
          throw new Error("Analysis job failed or timed out.");
        }
        sessionStorage.setItem("analysisJobId", latest.id);
        sessionStorage.setItem("analysisResults", JSON.stringify(latest.result));
        setStepStatus(3, "complete");
        setStepStatus(4, "complete");
        setProgress(100);
        navigate("/results");
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to analyze file. Please try again.";
        setErrorMessage(message);
        setSteps((prev) =>
          prev.map((step, idx) =>
            idx === 2 || idx === 3 || idx === 4
              ? { ...step, status: "error" as StepStatus }
              : step,
          ),
        );
      }
    };

    runAnalysis();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Analyzing Your Docker File
          </h1>
          <p className="text-slate-400">This may take a few moments...</p>
        </div>

        {/* Progress Bar */}
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

          <div className="grid grid-cols-5 gap-2">
            {steps.map((step) => (
              <div
                key={step.id}
                className={`h-1 rounded-full transition-colors ${
                  step.status === "complete"
                    ? "bg-green-500"
                    : step.status === "running"
                      ? "bg-blue-500"
                      : "bg-slate-700"
                }`}
              />
            ))}
          </div>
        </Card>

        {/* Analysis Steps */}
        <div className="space-y-3">
          {steps.map((step) => (
            <ProgressStep
              key={step.id}
              label={step.label}
              description={step.description}
              status={step.status}
            />
          ))}
        </div>

        {/* CI/CD Style Terminal Output */}
        <Card className="mt-6 p-4 bg-slate-950 border-slate-800 font-mono text-sm">
          <div className="space-y-1 text-slate-400">
            <div className="text-green-400">[✓] File loaded successfully</div>
            <div className="text-green-400">
              [✓] Running hadolint validator...
            </div>
            <div className="text-blue-400">
              [•] Checking for security issues...
            </div>
            <div className="text-slate-600">
              [·] Analyzing best practices...
            </div>
            <div className="text-slate-600">
              [·] Generating detailed report...
            </div>
          </div>
        </Card>
        {errorMessage && (
          <Card className="mt-6 p-4 bg-red-950/20 border-red-800">
            <p className="text-red-300 mb-3">{errorMessage}</p>
            <div className="flex gap-3">
              <Button onClick={() => window.location.reload()} variant="outline">
                Retry
              </Button>
              <Button onClick={() => navigate("/")} className="bg-blue-600 hover:bg-blue-700">
                Back to Upload
              </Button>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}
