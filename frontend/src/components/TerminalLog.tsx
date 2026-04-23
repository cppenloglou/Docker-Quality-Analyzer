import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

interface TerminalLogProps {
  logs: string[];
  title?: string;
  maxHeight?: string;
}

export function TerminalLog({ logs, title = 'Container Logs', maxHeight = '400px' }: TerminalLogProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 bg-slate-900/80">
        <Terminal className="w-4 h-4 text-green-400" />
        <span className="text-sm text-slate-300 font-mono">{title}</span>
      </div>
      
      <div 
        style={{ maxHeight }} 
        className="overflow-auto p-4 font-mono text-sm"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 italic">No logs yet...</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className="text-slate-300 mb-1 whitespace-pre-wrap">
              <span className="text-slate-600 mr-3">[{new Date().toLocaleTimeString()}]</span>
              {log}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
