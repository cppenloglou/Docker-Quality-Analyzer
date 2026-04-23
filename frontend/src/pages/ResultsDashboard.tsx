import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { CodePreview } from "../components/CodePreview";
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
  AlertCircle,
  AlertTriangle,
  Info,
  Shield,
  CheckCircle2,
  ArrowLeft,
  Play,
  Download,
} from "lucide-react";
import { getJob } from "../utils/api";

interface Issue {
  line: number;
  code: string;
  severity: string;
  message: string;
  suggestion: string;
}

interface Results {
  score: number;
  grade: string;
  errors: Issue[];
  warnings: Issue[];
  suggestions: Issue[];
  securityIssues: Issue[];
  meta?: {
    runnability?: {
      runnable: boolean;
      reasons: string[];
    };
  };
}

interface UploadedFile {
  name: string;
  type: string;
  content: string;
}

export function ResultsDashboard() {
  const navigate = useNavigate();
  const [results, setResults] = useState<Results | null>(() => {
    const storedResults = sessionStorage.getItem("analysisResults");
    return storedResults ? JSON.parse(storedResults) : null;
  });
  const [fileData] = useState<UploadedFile | null>(() => {
    const storedFile = sessionStorage.getItem("uploadedFile");
    return storedFile ? JSON.parse(storedFile) : null;
  });

  useEffect(() => {
    const jobId = sessionStorage.getItem("analysisJobId");
    if (!results && jobId) {
      getJob(jobId)
        .then((job) => {
          if (job.result) {
            setResults(job.result as Results);
            sessionStorage.setItem("analysisResults", JSON.stringify(job.result));
          }
        })
        .catch(() => navigate("/history"));
      return;
    }
    if (!results || !fileData) {
      navigate("/");
    }
  }, [fileData, navigate, results]);

  if (!results || !fileData) return null;

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

  const highlightedLines = [
    ...results.errors.map((e) => e.line),
    ...results.warnings.map((w) => w.line),
    ...results.securityIssues.map((s) => s.line),
  ];

  const isComposeFile = fileData.type === "docker-compose";
  const runnability = results.meta?.runnability;
  const composeRunnable = isComposeFile && runnability?.runnable === true;

  const handleRunContainers = () => {
    if (composeRunnable) {
      navigate("/execution");
    }
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">
                Analysis Results
              </h1>
              <p className="text-slate-400">{fileData.name}</p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <Download className="w-4 h-4 mr-2" />
                Export Report
              </Button>
              {isComposeFile && (
                <Button
                  onClick={handleRunContainers}
                  disabled={!composeRunnable}
                  title={
                    composeRunnable
                      ? "Deploy and run analyzed compose stack"
                      : "Upload the full project to deploy this compose stack."
                  }
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Run Containers
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Score Card */}
        <Card className="p-6 bg-slate-900 border-slate-800 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            <div className="md:col-span-2 flex items-center gap-4">
              <div className="text-center">
                <div
                  className={`text-6xl font-bold ${getScoreColor(results.score)}`}
                >
                  {results.score}
                </div>
                <div className="text-slate-400 text-sm mt-1">Quality Score</div>
              </div>
              <Badge
                className={`text-2xl px-4 py-2 ${getGradeColor(results.grade)}`}
              >
                Grade {results.grade}
              </Badge>
            </div>

            <Card className="p-4 bg-slate-950 border-slate-700 flex items-center gap-3">
              <div className="p-2 bg-red-500/10 rounded">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">
                  {results.errors.length}
                </div>
                <div className="text-sm text-slate-400">Errors</div>
              </div>
            </Card>

            <Card className="p-4 bg-slate-950 border-slate-700 flex items-center gap-3">
              <div className="p-2 bg-yellow-500/10 rounded">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">
                  {results.warnings.length}
                </div>
                <div className="text-sm text-slate-400">Warnings</div>
              </div>
            </Card>

            <Card className="p-4 bg-slate-950 border-slate-700 flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded">
                <Shield className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">
                  {results.securityIssues.length}
                </div>
                <div className="text-sm text-slate-400">Security</div>
              </div>
            </Card>
          </div>
        </Card>

        {isComposeFile && (
          <Card className="p-5 bg-slate-900 border-slate-800 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">
                  Deploy Runnability
                </h3>
                <p className="text-sm text-slate-400">
                  Standalone compose deployment is gated by strict precheck rules.
                </p>
              </div>
              <Badge
                className={
                  composeRunnable
                    ? "bg-green-500/20 text-green-400 border-green-500/30"
                    : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                }
              >
                {composeRunnable ? "Runnable" : "Not runnable from compose alone"}
              </Badge>
            </div>
            {!composeRunnable && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-amber-300">
                  View runnability blockers
                </summary>
                <ul className="mt-3 space-y-2 text-sm text-slate-300 list-disc list-inside">
                  {(runnability?.reasons || [
                    "No runnability metadata found. Upload full project for deploy.",
                  ]).map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        )}

        {/* Tabs for Issues */}
        <Tabs defaultValue="all" className="mb-6">
          <TabsList className="bg-slate-900 border border-slate-800">
            <TabsTrigger value="all">All Issues</TabsTrigger>
            <TabsTrigger value="errors">
              Errors ({results.errors.length})
            </TabsTrigger>
            <TabsTrigger value="warnings">
              Warnings ({results.warnings.length})
            </TabsTrigger>
            <TabsTrigger value="security">
              Security ({results.securityIssues.length})
            </TabsTrigger>
            <TabsTrigger value="suggestions">
              Suggestions ({results.suggestions.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-6 space-y-3">
            {renderIssues([
              ...results.errors,
              ...results.warnings,
              ...results.securityIssues,
              ...results.suggestions,
            ])}
          </TabsContent>

          <TabsContent value="errors" className="mt-6 space-y-3">
            {renderIssues(results.errors)}
          </TabsContent>

          <TabsContent value="warnings" className="mt-6 space-y-3">
            {renderIssues(results.warnings)}
          </TabsContent>

          <TabsContent value="security" className="mt-6 space-y-3">
            {renderIssues(results.securityIssues)}
          </TabsContent>

          <TabsContent value="suggestions" className="mt-6 space-y-3">
            {renderIssues(results.suggestions)}
          </TabsContent>
        </Tabs>

        {/* Code Preview with Highlights */}
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-white mb-4">
            Code with Highlighted Issues
          </h3>
          <CodePreview
            code={fileData.content}
            language={fileData.type === "docker-compose" ? "yaml" : "docker"}
            highlightedLines={highlightedLines}
            maxHeight="500px"
          />
        </div>
      </div>
    </Layout>
  );
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

          <div className="bg-slate-950 border border-slate-800 rounded p-3 mt-3">
            <div className="text-sm text-green-400 mb-1">
              💡 Recommended Fix:
            </div>
            <p className="text-sm text-slate-300">{issue.suggestion}</p>
          </div>
        </div>
      </div>
    </Card>
  ));
}
