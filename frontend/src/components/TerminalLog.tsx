import { useCallback, useEffect, useRef } from "react";
import { Terminal } from "lucide-react";

export interface TerminalLogEntry {
  message: string;
  timestamp?: string;
  tone?: "info" | "success" | "warning" | "error";
}

interface TerminalLogProps {
  logs: (string | TerminalLogEntry)[];
  title?: string;
  maxHeight?: string;
  emptyLabel?: string;
}

function toneClass(tone?: TerminalLogEntry["tone"]) {
  switch (tone) {
    case "success":
      return "text-emerald-300";
    case "warning":
      return "text-yellow-300";
    case "error":
      return "text-red-300";
    default:
      return "text-slate-300";
  }
}

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return new Date().toLocaleTimeString();
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleTimeString();
}

export function TerminalLog({
  logs,
  title = "Container Logs",
  maxHeight = "400px",
  emptyLabel = "No logs yet...",
}: TerminalLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    userScrolledUp.current = !atBottom;
  }, []);

  useEffect(() => {
    if (!userScrolledUp.current) {
      logsEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [logs]);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 bg-slate-900/80">
        <Terminal className="w-4 h-4 text-green-400" />
        <span className="text-sm text-slate-300 font-mono">{title}</span>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ maxHeight }}
        className="overflow-auto p-4 font-mono text-sm"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 italic">{emptyLabel}</div>
        ) : (
          logs.map((log, index) => {
            const entry: TerminalLogEntry =
              typeof log === "string" ? { message: log } : log;
            return (
              <div
                key={index}
                className={`${toneClass(entry.tone)} mb-1 whitespace-pre-wrap break-all`}
              >
                <span className="text-slate-600 mr-3">
                  [{formatTimestamp(entry.timestamp)}]
                </span>
                {entry.message}
              </div>
            );
          })
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
