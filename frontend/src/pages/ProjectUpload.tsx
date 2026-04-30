import { useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  FileArchive,
  Loader2,
  Package,
} from "lucide-react";

import { Layout } from "../components/Layout";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { ApiError, project } from "../utils/api";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value > 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function ProjectUpload() {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      const message = "Only .zip archives are supported.";
      setError(message);
      toast.error(message);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const queued = await project.upload(file);
      setUploadedFile(file);
      setJobId(queued.job_id);
      sessionStorage.setItem("projectJobId", queued.job_id);
      sessionStorage.setItem("analysisJobId", queued.job_id);
      toast.success(`Project queued for analysis (${queued.status})`);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed.";
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const goToAnalysis = () => {
    if (jobId) navigate(`/analysis?jobId=${jobId}`);
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
          <h1 className="text-3xl font-bold text-white">Project Upload</h1>
          <p className="text-slate-400 mt-2">
            Upload a project archive. The backend decision engine scans the
            archive, detects Dockerfiles and Compose files, and runs the
            appropriate analyzers.
          </p>
        </div>

        {!uploadedFile ? (
          <Card className="p-12 bg-slate-900 border-slate-800 border-2 border-dashed">
            <div className="flex flex-col items-center text-center">
              <div className="p-6 bg-blue-500/10 rounded-full mb-6">
                <FileArchive className="w-12 h-12 text-blue-400" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-3">
                Upload Project Archive
              </h2>
              <p className="text-slate-400 mb-8 max-w-md">
                Select a ZIP archive containing your application. We detect
                Dockerfiles and compose files, then queue an analysis job.
              </p>
              <Button
                asChild
                disabled={uploading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <label className="cursor-pointer">
                  {uploading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
                  ) : (
                    <FileArchive className="w-4 h-4 mr-2 inline" />
                  )}
                  {uploading ? "Uploading..." : "Choose ZIP File"}
                  <input
                    type="file"
                    accept=".zip"
                    className="hidden"
                    disabled={uploading}
                    onChange={handleFileUpload}
                  />
                </label>
              </Button>
              <p className="text-sm text-slate-500 mt-6">
                Supported format: .zip archives only.
              </p>
              {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
            </div>
          </Card>
        ) : (
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <Package className="w-6 h-6 text-green-400" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white mb-2 break-all">
                    {uploadedFile.name}
                  </h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                      Archive queued
                    </Badge>
                    <span className="text-sm text-slate-500">
                      {formatBytes(uploadedFile.size)}
                    </span>
                    {jobId && (
                      <span className="text-xs text-slate-500 font-mono break-all">
                        Job {jobId}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg mb-6">
              <p className="text-sm text-slate-300">
                The backend decision engine is scanning the archive. You can
                watch live events or pick another archive.
              </p>
            </div>

            <div className="flex gap-3 flex-wrap">
              <Button
                onClick={goToAnalysis}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <ArrowRight className="w-4 h-4 mr-2" /> Watch analysis progress
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setUploadedFile(null);
                  setJobId(null);
                }}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Upload a different archive
              </Button>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}
