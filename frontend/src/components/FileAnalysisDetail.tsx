import { useState } from "react";
import { FileCode, FileText, ChevronDown, ChevronRight, Layers, HardDrive, Cpu } from "lucide-react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { IssueTabs } from "./IssueTabs";
import { CodePreview } from "./CodePreview";
import type { PerFileAnalysisResult } from "../utils/api";

function scoreColor(score: number) {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  return "text-red-400";
}

function gradeColor(grade: string) {
  if (grade === "A") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (grade === "B") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

interface FileAnalysisDetailProps {
  file: PerFileAnalysisResult;
  defaultOpen?: boolean;
}

export function FileAnalysisDetail({ file, defaultOpen = false }: FileAnalysisDetailProps) {
  const [expanded, setExpanded] = useState(defaultOpen);

  const errors = file.errors ?? [];
  const warnings = file.warnings ?? [];
  const securityIssues = file.securityIssues ?? [];
  const suggestions = file.suggestions ?? [];
  const allIssues = [...errors, ...warnings, ...securityIssues, ...suggestions];

  const meta = (file.meta ?? {}) as Record<string, unknown>;
  const estimate = meta.estimate as Record<string, unknown> | undefined;
  const runnability = meta.runnability as {
    runnable?: boolean;
    reasons?: string[];
    rules?: Record<string, boolean>;
  } | undefined;

  const highlightedLines = [
    ...errors.map(e => e.line),
    ...warnings.map(w => w.line),
    ...securityIssues.map(s => s.line),
  ];

  return (
    <Card className="bg-slate-900 border-slate-800 overflow-hidden">
      {/* Header — always visible, click to expand */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full p-4 flex items-center gap-3 text-left hover:bg-slate-800/50 transition-colors"
      >
        {file.file_type === "dockerfile" ? (
          <FileCode className="w-4 h-4 text-blue-400 shrink-0" />
        ) : (
          <FileText className="w-4 h-4 text-green-400 shrink-0" />
        )}
        <span className="flex-1 font-mono text-sm text-white truncate">{file.file_path}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-sm font-bold ${scoreColor(file.score)}`}>{file.score}</span>
          <Badge className={`text-xs ${gradeColor(file.grade)}`}>Grade {file.grade}</Badge>
          {file.errors_count > 0 && (
            <span className="text-xs text-red-400">{file.errors_count}E</span>
          )}
          {file.warnings_count > 0 && (
            <span className="text-xs text-yellow-400">{file.warnings_count}W</span>
          )}
          {file.security_count > 0 && (
            <span className="text-xs text-orange-400">{file.security_count}S</span>
          )}
          {file.suggestions_count > 0 && (
            <span className="text-xs text-blue-400">{file.suggestions_count}I</span>
          )}
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-800 p-4 space-y-5">
          {/* Issue count summary row */}
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="p-2 bg-red-950/20 rounded border border-red-800/40">
              <div className="text-red-400 font-bold text-base">{file.errors_count}</div>
              <div className="text-slate-500">Errors</div>
            </div>
            <div className="p-2 bg-yellow-950/20 rounded border border-yellow-800/40">
              <div className="text-yellow-400 font-bold text-base">{file.warnings_count}</div>
              <div className="text-slate-500">Warnings</div>
            </div>
            <div className="p-2 bg-orange-950/20 rounded border border-orange-800/40">
              <div className="text-orange-400 font-bold text-base">{file.security_count}</div>
              <div className="text-slate-500">Security</div>
            </div>
            <div className="p-2 bg-blue-950/20 rounded border border-blue-800/40">
              <div className="text-blue-400 font-bold text-base">{file.suggestions_count}</div>
              <div className="text-slate-500">Suggestions</div>
            </div>
          </div>

          {/* Issue tabs */}
          {allIssues.length > 0 && (
            <IssueTabs
              errors={errors}
              warnings={warnings}
              securityIssues={securityIssues}
              suggestions={suggestions}
            />
          )}

          {/* Meta section for Dockerfiles */}
          {file.file_type === "dockerfile" && estimate && (
            <div>
              <h4 className="text-sm font-semibold text-slate-300 mb-2">Resource Estimate</h4>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {(estimate.estimated_layers != null) && (
                  <div className="flex items-center gap-2 p-2 rounded bg-slate-950 border border-slate-800">
                    <Layers className="w-4 h-4 text-blue-400" />
                    <div>
                      <div className="text-slate-400">Layers</div>
                      <div className="text-white font-semibold">{String(estimate.estimated_layers)}</div>
                    </div>
                  </div>
                )}
                {(estimate.estimated_memory_mb != null) && (
                  <div className="flex items-center gap-2 p-2 rounded bg-slate-950 border border-slate-800">
                    <HardDrive className="w-4 h-4 text-purple-400" />
                    <div>
                      <div className="text-slate-400">Memory</div>
                      <div className="text-white font-semibold">{String(estimate.estimated_memory_mb)} MB</div>
                    </div>
                  </div>
                )}
                {(estimate.estimated_cpu_millicores != null) && (
                  <div className="flex items-center gap-2 p-2 rounded bg-slate-950 border border-slate-800">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div className="text-slate-400">CPU</div>
                      <div className="text-white font-semibold">{String(estimate.estimated_cpu_millicores)}m</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Meta section for Compose files */}
          {file.file_type === "compose" && (
            <div className="space-y-2 text-xs">
              {runnability && (
                <div className="p-3 rounded border border-slate-800 bg-slate-950/50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white mb-0.5">Deploy Runnability</p>
                      <p className="text-xs text-slate-400">Strict precheck rules decide whether this compose file can be deployed.</p>
                    </div>
                    <Badge
                      className={
                        runnability.runnable
                          ? "bg-green-500/20 text-green-400 border-green-500/30"
                          : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                      }
                    >
                      {runnability.runnable ? "Runnable" : "Blocked"}
                    </Badge>
                  </div>
                  {!runnability.runnable && (
                    <ul className="mt-3 space-y-1 text-slate-300 list-disc list-inside">
                      {(runnability.reasons ?? ["No runnability metadata found."]).map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                  {runnability.rules && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-slate-400">
                        Inspect runnability rules
                      </summary>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        {Object.entries(runnability.rules).map(([rule, passed]) => (
                          <div
                            key={rule}
                            className={`flex items-center gap-2 p-2 rounded border ${
                              passed
                                ? "border-green-500/30 bg-green-500/5 text-green-300"
                                : "border-amber-500/30 bg-amber-500/5 text-amber-300"
                            }`}
                          >
                            <span className="font-mono truncate">{rule}</span>
                            <span className="ml-auto">{passed ? "pass" : "fail"}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Source preview */}
          {file.source_preview ? (
            <div>
              <h4 className="text-sm font-semibold text-slate-300 mb-2">Source Preview</h4>
              <CodePreview
                code={file.source_preview}
                language={file.file_type === "dockerfile" ? "docker" : "yaml"}
                highlightedLines={highlightedLines}
                maxHeight="320px"
              />
            </div>
          ) : (
            <p className="text-xs text-slate-600 italic">Source preview not available for this file.</p>
          )}
        </div>
      )}
    </Card>
  );
}
