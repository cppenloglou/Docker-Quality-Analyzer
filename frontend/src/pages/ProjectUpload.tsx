import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronLeft,
  Loader2,
} from "lucide-react";

import { Layout } from "../components/Layout";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { MotionPage } from "../components/motion";
import { dragActiveVariants, dragActiveTransition } from "../components/motion/variants";
import { ApiError, project } from "../utils/api";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let u = 0;
  while (v > 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

type Step = "upload" | "uploading";

export function ProjectUpload() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void startUpload(f);
  };

  const startUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Only .zip archives are supported.");
      toast.error("Only .zip archives are supported.");
      return;
    }
    setError(null);
    setSelectedFile(file);
    setStep("uploading");

    try {
      const resp = await project.upload(file);
      sessionStorage.setItem("analysisJobId", resp.job_id);
      sessionStorage.setItem("projectJobId", resp.job_id);
      toast.success("Project queued for analysis!");
      navigate(`/analysis?jobId=${resp.job_id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed.";
      setError(msg);
      toast.error(msg);
      setStep("upload");
    }
  };

  return (
    <Layout>
      <MotionPage>
        <div className="max-w-2xl mx-auto px-4">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => navigate("/")}
              className="flex items-center gap-2 text-slate-400 hover:text-white mb-4 motion-safe:transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back to home
            </button>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                <Archive className="w-5 h-5 text-purple-400" />
              </div>
              <h1 className="text-2xl font-bold text-white">Project Analysis</h1>
            </div>
            <p className="text-slate-400">
              Upload a ZIP archive to analyze all Dockerfiles and Compose files, and build all images automatically.
            </p>
          </div>

          {/* Error */}
          {error && (
            <Card className="p-4 bg-red-950/40 border-red-800 mb-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            </Card>
          )}

          {/* Step: upload */}
          {step === "upload" && (
            <motion.div
              initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
            >
              <motion.div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                animate={isDragging ? "active" : "idle"}
                variants={reducedMotion ? undefined : dragActiveVariants}
                transition={dragActiveTransition}
                className={`border-2 border-dashed rounded-xl p-14 text-center cursor-pointer motion-safe:transition-[border-color,background-color] motion-safe:duration-200 ${
                  isDragging ? "border-purple-500 bg-purple-500/5" : "border-slate-700 bg-slate-900/50 hover:border-slate-600"
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <motion.div
                  animate={isDragging && !reducedMotion ? { scale: 1.1 } : { scale: 1 }}
                  transition={{ duration: 0.2 }}
                  className={`w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center ${isDragging ? "bg-purple-500/20" : "bg-slate-800"}`}
                >
                  <Archive className={`w-8 h-8 ${isDragging ? "text-purple-400" : "text-slate-400"}`} />
                </motion.div>
                <h3 className="text-lg font-semibold text-white mb-2">Drop your project archive here</h3>
                <p className="text-slate-400 text-sm mb-6">Accepts .zip archives up to 30 MB</p>
                <Button
                  onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <Archive className="w-4 h-4 mr-2" />
                  Select ZIP archive
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void startUpload(f); e.target.value = ""; }}
                />
              </motion.div>

              <Card className="mt-6 p-5 bg-slate-900 border-slate-800">
                <h4 className="text-sm font-semibold text-white mb-3">What happens automatically</h4>
                <div className="grid grid-cols-2 gap-2 text-sm text-slate-400">
                  {[
                    "All Dockerfiles analyzed",
                    "All Compose files checked",
                    "Security issues scanned",
                    "Best practices reviewed",
                    "All images built",
                    "Runnability checked",
                  ].map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-4">
                  After analysis, select which Compose file to run directly from the results page.
                </p>
              </Card>
            </motion.div>
          )}

          {/* Step: uploading */}
          {step === "uploading" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16"
            >
              <Loader2 className="w-12 h-12 text-purple-400 mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-semibold text-white mb-2">Uploading and scanning…</h3>
              <p className="text-slate-400 text-sm">
                {selectedFile ? `${selectedFile.name} (${formatBytes(selectedFile.size)})` : "Processing archive"}
              </p>
              <p className="text-slate-500 text-xs mt-2">Analysis will start automatically</p>
            </motion.div>
          )}
        </div>
      </MotionPage>
    </Layout>
  );
}
