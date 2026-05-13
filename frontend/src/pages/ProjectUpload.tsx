import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FileCode,
  FileText,
  Loader2,
  Package,
  Play,
  Wrench,
  X,
} from "lucide-react";

import { Layout } from "../components/Layout";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { MotionPage, StaggerList, StaggerItem } from "../components/motion";
import { dragActiveVariants, dragActiveTransition } from "../components/motion/variants";
import { ApiError, project, type ProjectScanResponse } from "../utils/api";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let u = 0;
  while (v > 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

type Step = "upload" | "scanning" | "review" | "plan" | "confirming";

const STEP_LABELS: Record<Step, string> = {
  upload: "Upload",
  scanning: "Scanning",
  review: "Review",
  plan: "Plan",
  confirming: "Starting",
};

const STEPS: Step[] = ["upload", "review", "plan"];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectUpload() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanResult, setScanResult] = useState<ProjectScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Selections
  const [selectedDockerfiles, setSelectedDockerfiles] = useState<string[]>([]);
  const [selectedCompose, setSelectedCompose] = useState<string[]>([]);
  const [primaryCompose, setPrimaryCompose] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<"auto" | "dockerfile-only" | "compose-only" | "full-project">("auto");
  const [buildImages, setBuildImages] = useState(false);
  const [runAfter, setRunAfter] = useState(false);

  // ── Drag & drop ──────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) startScan(f);
  };

  // ── Scan ─────────────────────────────────────────────────────────────────

  const startScan = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Only .zip archives are supported.");
      toast.error("Only .zip archives are supported.");
      return;
    }
    setError(null);
    setSelectedFile(file);
    setStep("scanning");

    try {
      const result = await project.scan(file);
      setScanResult(result);
      // Pre-select per recommendation
      const rec = result.recommendation;
      setSelectedDockerfiles(rec.primary_dockerfile ? [rec.primary_dockerfile] : result.detected.dockerfiles.slice(0, 1));
      setSelectedCompose(rec.primary_compose_file ? [rec.primary_compose_file] : result.detected.compose_files.slice(0, 1));
      setPrimaryCompose(rec.primary_compose_file ?? result.detected.compose_files[0] ?? null);
      // Set mode
      const mode = rec.analysis_mode;
      const validModes = ["auto", "dockerfile-only", "compose-only", "full-project"] as const;
      const safeMode = (validModes as readonly string[]).includes(mode)
        ? (mode as typeof analysisMode)
        : "auto";
      setAnalysisMode(safeMode);
      setStep("review");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Scan failed.";
      setError(msg);
      toast.error(msg);
      setStep("upload");
    }
  };

  // ── Analyze ───────────────────────────────────────────────────────────────

  const startAnalysis = async () => {
    if (!scanResult) return;
    setError(null);
    setStep("confirming");

    const effectiveDFs = selectedDockerfiles.length > 0 ? selectedDockerfiles : scanResult.detected.dockerfiles;
    const effectiveCFs = selectedCompose.length > 0 ? selectedCompose : scanResult.detected.compose_files;

    try {
      const resp = await project.analyze({
        project_id: scanResult.project_id,
        selected_dockerfiles: effectiveDFs,
        selected_compose_files: effectiveCFs,
        primary_compose_file: primaryCompose,
        analysis_mode: analysisMode,
        build_selected_images: buildImages,
        run_after_analysis: runAfter,
      });
      sessionStorage.setItem("analysisJobId", resp.job_id);
      sessionStorage.setItem("projectJobId", resp.job_id);
      toast.success("Project analysis queued!");
      navigate(`/analysis?jobId=${resp.job_id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to start analysis.";
      setError(msg);
      toast.error(msg);
      setStep("plan");
    }
  };

  // ── Toggle helpers ────────────────────────────────────────────────────────

  const toggleDockerfile = (df: string) => {
    setSelectedDockerfiles(prev =>
      prev.includes(df) ? prev.filter(x => x !== df) : [...prev, df]
    );
  };

  const toggleCompose = (cf: string) => {
    setSelectedCompose(prev => {
      const next = prev.includes(cf) ? prev.filter(x => x !== cf) : [...prev, cf];
      if (!next.includes(primaryCompose ?? "")) {
        setPrimaryCompose(next[0] ?? null);
      }
      return next;
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Layout>
      <MotionPage>
        <div className="max-w-3xl mx-auto px-4">
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
            <p className="text-slate-400">Upload a ZIP archive to scan and analyze your Docker project.</p>
          </div>

          {/* Step indicator */}
          {step !== "scanning" && step !== "confirming" && (
            <div className="flex items-center gap-2 mb-8">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold motion-safe:transition-all ${
                    step === s ? "bg-purple-600 text-white" :
                    STEPS.indexOf(step) > i ? "bg-green-600 text-white" :
                    "bg-slate-800 text-slate-500"
                  }`}>
                    {STEPS.indexOf(step) > i ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className={`text-sm ${step === s ? "text-white" : "text-slate-500"}`}>{STEP_LABELS[s]}</span>
                  {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-slate-700 mx-1" />}
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <Card className="p-4 bg-red-950/40 border-red-800 mb-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            </Card>
          )}

          {/* ── Step: upload ─────────────────────────────────────────────────── */}
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
                  onChange={e => { const f = e.target.files?.[0]; if (f) startScan(f); e.target.value = ""; }}
                />
              </motion.div>

              <Card className="mt-6 p-5 bg-slate-900 border-slate-800">
                <h4 className="text-sm font-semibold text-white mb-3">What gets analyzed?</h4>
                <div className="grid grid-cols-2 gap-2 text-sm text-slate-400">
                  {["Dockerfiles & variants", "Compose files", "Security issues", "Best practices", "Resource estimates", "Runnability checks"].map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}

          {/* ── Step: scanning ───────────────────────────────────────────────── */}
          {step === "scanning" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16"
            >
              <Loader2 className="w-12 h-12 text-purple-400 mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-semibold text-white mb-2">Scanning archive…</h3>
              <p className="text-slate-400 text-sm">
                {selectedFile ? `${selectedFile.name} (${formatBytes(selectedFile.size)})` : "Detecting Docker assets"}
              </p>
            </motion.div>
          )}

          {/* ── Step: review ─────────────────────────────────────────────────── */}
          {step === "review" && scanResult && (
            <motion.div
              initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
            >
              {/* Archive info */}
              <Card className="p-4 bg-slate-900 border-slate-800 mb-6 flex items-center gap-3">
                <Archive className="w-5 h-5 text-purple-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{scanResult.archive_name}</p>
                  {selectedFile && <p className="text-slate-400 text-xs">{formatBytes(selectedFile.size)}</p>}
                </div>
                <button onClick={() => setStep("upload")} className="text-slate-500 hover:text-white p-1">
                  <X className="w-4 h-4" />
                </button>
              </Card>

              {/* Warnings */}
              {scanResult.warnings.length > 0 && (
                <Card className="p-4 bg-yellow-950/30 border-yellow-800/50 mb-6">
                  {scanResult.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-yellow-300 text-sm">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </Card>
              )}

              {/* Stacks */}
              {scanResult.detected.stacks.length > 0 && (
                <div className="mb-6">
                  <p className="text-slate-400 text-xs mb-2 uppercase tracking-wider">Detected stacks</p>
                  <div className="flex flex-wrap gap-2">
                    {scanResult.detected.stacks.map(s => (
                      <Badge key={s} variant="secondary" className="bg-slate-800 text-slate-300">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Dockerfiles */}
              {scanResult.detected.dockerfiles.length > 0 && (
                <div className="mb-6">
                  <p className="text-slate-400 text-xs mb-3 uppercase tracking-wider">
                    Dockerfiles <span className="text-slate-600">({scanResult.detected.dockerfiles.length} found)</span>
                  </p>
                  <StaggerList className="space-y-2">
                    {scanResult.detected.dockerfiles.map(df => (
                      <StaggerItem key={df}>
                        <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer motion-safe:transition-colors ${
                          selectedDockerfiles.includes(df)
                            ? "border-blue-600 bg-blue-900/20"
                            : "border-slate-800 bg-slate-900/50 hover:border-slate-700"
                        }`}>
                          <input
                            type="checkbox"
                            checked={selectedDockerfiles.includes(df)}
                            onChange={() => toggleDockerfile(df)}
                            className="hidden"
                          />
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            selectedDockerfiles.includes(df) ? "bg-blue-600 border-blue-600" : "border-slate-600"
                          }`}>
                            {selectedDockerfiles.includes(df) && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <FileCode className="w-4 h-4 text-blue-400 shrink-0" />
                          <span className="text-sm text-white font-mono truncate flex-1">{df}</span>
                        </label>
                      </StaggerItem>
                    ))}
                  </StaggerList>
                </div>
              )}

              {/* Compose files */}
              {scanResult.detected.compose_files.length > 0 && (
                <div className="mb-6">
                  <p className="text-slate-400 text-xs mb-3 uppercase tracking-wider">
                    Compose files <span className="text-slate-600">({scanResult.detected.compose_files.length} found)</span>
                  </p>
                  <StaggerList className="space-y-2">
                    {scanResult.detected.compose_files.map(cf => (
                      <StaggerItem key={cf}>
                        <div className={`flex items-center gap-3 p-3 rounded-lg border motion-safe:transition-colors ${
                          selectedCompose.includes(cf)
                            ? "border-green-700 bg-green-900/20"
                            : "border-slate-800 bg-slate-900/50"
                        }`}>
                          <label className="flex items-center gap-3 flex-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedCompose.includes(cf)}
                              onChange={() => toggleCompose(cf)}
                              className="hidden"
                            />
                            <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              selectedCompose.includes(cf) ? "bg-green-600 border-green-600" : "border-slate-600"
                            }`}>
                              {selectedCompose.includes(cf) && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <FileText className="w-4 h-4 text-green-400 shrink-0" />
                            <span className="text-sm text-white font-mono truncate">{cf}</span>
                          </label>
                          {selectedCompose.includes(cf) && selectedCompose.length > 1 && (
                            <button
                              onClick={() => setPrimaryCompose(cf)}
                              className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                                primaryCompose === cf
                                  ? "bg-green-700 text-white"
                                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                              }`}
                            >
                              {primaryCompose === cf ? "Primary" : "Set primary"}
                            </button>
                          )}
                        </div>
                      </StaggerItem>
                    ))}
                  </StaggerList>
                </div>
              )}

              {/* Services */}
              {scanResult.detected.services.length > 0 && (
                <div className="mb-6">
                  <p className="text-slate-400 text-xs mb-3 uppercase tracking-wider">
                    Detected services ({scanResult.detected.services.length})
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {scanResult.detected.services.map(svc => (
                      <div key={`${svc.compose_file}:${svc.name}`} className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="flex items-center gap-2 mb-1">
                          <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="text-sm font-medium text-white truncate">{svc.name}</span>
                        </div>
                        {svc.image && <p className="text-xs text-slate-500 truncate">{svc.image}</p>}
                        {svc.build_context && <p className="text-xs text-blue-400/80 truncate">build: {svc.build_context}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No docker files found */}
              {scanResult.detected.dockerfiles.length === 0 && scanResult.detected.compose_files.length === 0 && (
                <Card className="p-6 bg-slate-900 border-slate-800 text-center">
                  <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-3" />
                  <p className="text-white font-medium mb-1">No Docker files detected</p>
                  <p className="text-slate-400 text-sm">This archive does not appear to contain any Dockerfiles or Compose files.</p>
                </Card>
              )}

              <div className="flex gap-3 mt-6">
                <Button variant="outline" onClick={() => setStep("upload")} className="border-slate-700 text-slate-300">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={() => setStep("plan")}
                  disabled={selectedDockerfiles.length === 0 && selectedCompose.length === 0}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
                >
                  Configure plan <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step: plan ───────────────────────────────────────────────────── */}
          {step === "plan" && scanResult && (
            <motion.div
              initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
            >
              <div className="space-y-4 mb-6">
                {/* Analysis mode */}
                <Card className="p-5 bg-slate-900 border-slate-800">
                  <p className="text-sm font-semibold text-white mb-3">Analysis mode</p>
                  <div className="space-y-2">
                    {(
                      [
                        { value: "auto", label: "Auto (recommended)", desc: "Analyzes all selected files" },
                        { value: "dockerfile-only", label: "Dockerfiles only", desc: "Only analyze selected Dockerfiles", disabled: selectedDockerfiles.length === 0 },
                        { value: "compose-only", label: "Compose files only", desc: "Only analyze selected Compose files", disabled: selectedCompose.length === 0 },
                        { value: "full-project", label: "Full project", desc: "All Dockerfiles + Compose + mapping", disabled: selectedDockerfiles.length === 0 || selectedCompose.length === 0 },
                      ] as { value: typeof analysisMode; label: string; desc: string; disabled?: boolean }[]
                    ).map(opt => (
                      <label
                        key={opt.value}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer motion-safe:transition-colors ${
                          opt.disabled
                            ? "border-slate-800 opacity-40 cursor-not-allowed"
                            : analysisMode === opt.value
                            ? "border-purple-600 bg-purple-900/20"
                            : "border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        <input
                          type="radio"
                          name="analysisMode"
                          value={opt.value}
                          checked={analysisMode === opt.value}
                          disabled={opt.disabled}
                          onChange={() => !opt.disabled && setAnalysisMode(opt.value)}
                          className="hidden"
                        />
                        <div className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 ${
                          analysisMode === opt.value ? "border-purple-500 bg-purple-500" : "border-slate-600"
                        }`}>
                          {analysisMode === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{opt.label}</p>
                          <p className="text-xs text-slate-400">{opt.desc}</p>
                          {opt.disabled && <p className="text-xs text-slate-600 mt-0.5">Not available — select the required files in review step</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                </Card>

                {/* Optional actions */}
                <Card className="p-5 bg-slate-900 border-slate-800">
                  <p className="text-sm font-semibold text-white mb-3">Optional actions</p>
                  <div className="space-y-3">
                    <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer motion-safe:transition-colors ${
                      selectedDockerfiles.length === 0 ? "border-slate-800 opacity-40 cursor-not-allowed" :
                      buildImages ? "border-blue-600 bg-blue-900/15" : "border-slate-800 hover:border-slate-700"
                    }`}>
                      <input
                        type="checkbox"
                        checked={buildImages}
                        disabled={selectedDockerfiles.length === 0}
                        onChange={e => setBuildImages(e.target.checked)}
                        className="hidden"
                      />
                      <div className={`w-4 h-4 rounded border flex items-center justify-center mt-0.5 shrink-0 ${
                        buildImages ? "bg-blue-600 border-blue-600" : "border-slate-600"
                      }`}>
                        {buildImages && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <Wrench className="w-3.5 h-3.5 text-blue-400" />
                          <p className="text-sm font-medium text-white">Build selected images</p>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">Build Dockerfiles into Docker images after analysis</p>
                        {selectedDockerfiles.length === 0 && <p className="text-xs text-slate-600 mt-0.5">Requires at least one Dockerfile</p>}
                      </div>
                    </label>

                    <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer motion-safe:transition-colors ${
                      selectedCompose.length === 0 ? "border-slate-800 opacity-40 cursor-not-allowed" :
                      runAfter ? "border-green-600 bg-green-900/15" : "border-slate-800 hover:border-slate-700"
                    }`}>
                      <input
                        type="checkbox"
                        checked={runAfter}
                        disabled={selectedCompose.length === 0}
                        onChange={e => setRunAfter(e.target.checked)}
                        className="hidden"
                      />
                      <div className={`w-4 h-4 rounded border flex items-center justify-center mt-0.5 shrink-0 ${
                        runAfter ? "bg-green-600 border-green-600" : "border-slate-600"
                      }`}>
                        {runAfter && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <Play className="w-3.5 h-3.5 text-green-400" />
                          <p className="text-sm font-medium text-white">Run Compose stack after analysis</p>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">Deploy the selected Compose stack after a successful analysis</p>
                        {selectedCompose.length === 0 && <p className="text-xs text-slate-600 mt-0.5">Requires at least one Compose file</p>}
                      </div>
                    </label>
                  </div>
                </Card>

                {/* Summary */}
                <Card className="p-4 bg-slate-950 border-slate-800">
                  <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Analysis plan summary</p>
                  <div className="space-y-1 text-sm text-slate-300">
                    <div className="flex gap-2"><span className="text-slate-500">Archive:</span><span className="truncate">{scanResult.archive_name}</span></div>
                    <div className="flex gap-2"><span className="text-slate-500">Dockerfiles:</span><span>{selectedDockerfiles.length || "none selected"}</span></div>
                    <div className="flex gap-2"><span className="text-slate-500">Compose:</span><span>{selectedCompose.length || "none selected"}</span></div>
                    <div className="flex gap-2"><span className="text-slate-500">Mode:</span><span>{analysisMode}</span></div>
                    {buildImages && <div className="flex gap-2"><span className="text-slate-500">Build images:</span><span className="text-blue-400">yes</span></div>}
                    {runAfter && <div className="flex gap-2"><span className="text-slate-500">Run compose:</span><span className="text-green-400">yes (after analysis)</span></div>}
                  </div>
                </Card>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("review")} className="border-slate-700 text-slate-300">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={startAnalysis}
                  disabled={selectedDockerfiles.length === 0 && selectedCompose.length === 0}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
                >
                  Start analysis <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step: confirming ─────────────────────────────────────────────── */}
          {step === "confirming" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16"
            >
              <Loader2 className="w-12 h-12 text-purple-400 mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-semibold text-white mb-2">Queuing analysis…</h3>
              <p className="text-slate-400 text-sm">Submitting your project for analysis</p>
            </motion.div>
          )}
        </div>
      </MotionPage>
    </Layout>
  );
}
