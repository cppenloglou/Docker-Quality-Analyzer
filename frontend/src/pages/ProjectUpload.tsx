import { useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { CodePreview } from "../components/CodePreview";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  FileArchive,
  FolderOpen,
  FileCode,
  ArrowLeft,
  Package,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { uploadProjectArchive } from "../utils/api";

export function ProjectUpload() {
  const navigate = useNavigate();
  const [projectUploaded, setProjectUploaded] = useState(false);
  const [archiveName, setArchiveName] = useState("my-node-app.zip");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setError(null);
      const queued = await uploadProjectArchive(file);
      setArchiveName(file.name);
      setProjectUploaded(true);
      setJobId(queued.job_id);
      sessionStorage.setItem("projectJobId", queued.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    }
  };

  const handleBuildImage = () => {
    if (jobId) {
      sessionStorage.setItem("analysisJobId", jobId);
    }
    navigate("/image-build");
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
          <h1 className="text-3xl font-bold text-white">Project Upload</h1>
          <p className="text-slate-400 mt-2">
            Upload a complete project with Dockerfile for image building and
            analysis
          </p>
        </div>

        {!projectUploaded ? (
          /* Upload Area */
          <Card className="p-12 bg-slate-900 border-slate-800 border-2 border-dashed">
            <div className="flex flex-col items-center text-center">
              <div className="p-6 bg-blue-500/10 rounded-full mb-6">
                <FileArchive className="w-12 h-12 text-blue-400" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-3">
                Upload Project Archive
              </h2>
              <p className="text-slate-400 mb-8 max-w-md">
                Upload a ZIP file containing your application source code and
                Dockerfile. We'll automatically detect the Dockerfile and build
                your Docker image.
              </p>
              <div className="flex gap-4">
                <Button
                  asChild
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <label className="cursor-pointer">
                    <FileArchive className="w-4 h-4 mr-2 inline" />
                    Choose ZIP File
                    <input type="file" accept=".zip" className="hidden" onChange={handleFileUpload} />
                  </label>
                </Button>
                <Button
                  variant="outline"
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Browse Examples
                </Button>
              </div>
              <p className="text-sm text-slate-500 mt-6">
                Supported formats: .zip, .tar.gz (max 100MB)
              </p>
              {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Project Info */}
            <Card className="p-6 bg-slate-900 border-slate-800">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-green-500/10 rounded-lg">
                    <Package className="w-6 h-6 text-green-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-white mb-2">
                      {archiveName}
                    </h2>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                        Project Archive
                      </Badge>
                      <span className="text-sm text-slate-500">2.4 MB</span>
                      <span className="text-sm text-slate-500">Job {jobId?.slice(0, 8)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Detected Dockerfile */}
              <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <FileCode className="w-5 h-5 text-blue-400" />
                  <span className="text-white font-medium">
                    Dockerfile Detected
                  </span>
                  <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                    ./Dockerfile
                  </Badge>
                </div>
                <p className="text-sm text-slate-400">
                  Project uploaded and queued for archive detection and analysis.
                </p>
              </div>

              <Button
                onClick={handleBuildImage}
                className="bg-blue-600 hover:bg-blue-700 w-full"
              >
                <Package className="w-4 h-4 mr-2" />
                Build Docker Image
              </Button>
            </Card>

            {/* Project Structure */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6 bg-slate-900 border-slate-800">
                <div className="flex items-center gap-2 mb-4">
                  <FolderOpen className="w-5 h-5 text-blue-400" />
                  <h3 className="text-lg font-semibold text-white">
                    Project Structure
                  </h3>
                </div>
                <div className="space-y-1 font-mono text-sm">
                  {[
                    { type: "folder", name: "project/", size: "--" },
                    { type: "file", name: "Dockerfile", size: "detected if present" },
                    { type: "file", name: "docker-compose.yml", size: "detected if present" },
                  ].map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-2 px-3 hover:bg-slate-800/50 rounded"
                    >
                      <div className="flex items-center gap-2">
                        {item.type === "folder" ? (
                          <FolderOpen className="w-4 h-4 text-blue-400" />
                        ) : (
                          <FileCode className="w-4 h-4 text-slate-400" />
                        )}
                        <span
                          className={
                            item.type === "folder"
                              ? "text-blue-400"
                              : "text-slate-300"
                          }
                        >
                          {item.name}
                        </span>
                      </div>
                      <span className="text-slate-500 text-xs">
                        {item.size}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Dockerfile Preview */}
              <Card className="p-6 bg-slate-900 border-slate-800">
                <div className="flex items-center gap-2 mb-4">
                  <FileCode className="w-5 h-5 text-blue-400" />
                  <h3 className="text-lg font-semibold text-white">
                    Dockerfile Preview
                  </h3>
                </div>
                <CodePreview
                  code={"# Dockerfile preview available in job output.\nFROM node:20-alpine"}
                  language="docker"
                  maxHeight="400px"
                />
              </Card>
            </div>

            {/* Actions */}
            <div className="flex gap-4">
              <Button
                onClick={() => setProjectUploaded(false)}
                variant="outline"
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Upload Different Project
              </Button>
              <Button
                onClick={handleBuildImage}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Package className="w-4 h-4 mr-2" />
                Build Docker Image
              </Button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
