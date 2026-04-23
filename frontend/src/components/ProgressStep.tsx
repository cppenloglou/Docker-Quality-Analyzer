import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

interface ProgressStepProps {
  label: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  description?: string;
}

export function ProgressStep({ label, status, description }: ProgressStepProps) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-lg bg-slate-900/50 border border-slate-800">
      <div className="flex-shrink-0 mt-1">
        {status === 'complete' && (
          <CheckCircle2 className="w-5 h-5 text-green-500" />
        )}
        {status === 'running' && (
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
        )}
        {status === 'pending' && (
          <Circle className="w-5 h-5 text-slate-600" />
        )}
        {status === 'error' && (
          <Circle className="w-5 h-5 text-red-500" />
        )}
      </div>
      
      <div className="flex-1">
        <div className={`font-medium ${
          status === 'complete' ? 'text-green-400' :
          status === 'running' ? 'text-blue-400' :
          status === 'error' ? 'text-red-400' :
          'text-slate-500'
        }`}>
          {label}
        </div>
        {description && (
          <div className="text-sm text-slate-400 mt-1">{description}</div>
        )}
      </div>
    </div>
  );
}
