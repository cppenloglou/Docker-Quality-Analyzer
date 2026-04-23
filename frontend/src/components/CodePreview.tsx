import { Copy, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ComponentType } from 'react';
import { Button } from './ui/button';

interface CodePreviewProps {
  code: string;
  language?: string;
  highlightedLines?: number[];
  maxHeight?: string;
}

export function CodePreview({ 
  code, 
  language = 'docker', 
  highlightedLines = [],
  maxHeight = '500px'
}: CodePreviewProps) {
  const [copied, setCopied] = useState(false);
  const [highlighter, setHighlighter] = useState<{
    SyntaxHighlighter: ComponentType<Record<string, unknown>>;
    style: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadHighlighter() {
      const [{ Prism }, { vscDarkPlus }] = await Promise.all([
        import('react-syntax-highlighter'),
        import('react-syntax-highlighter/dist/esm/styles/prism'),
      ]);
      if (mounted) {
        setHighlighter({
          SyntaxHighlighter:
            Prism as unknown as ComponentType<Record<string, unknown>>,
          style: vscDarkPlus as Record<string, unknown>,
        });
      }
    }
    loadHighlighter();
    return () => {
      mounted = false;
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 bg-slate-800/50">
        <span className="text-sm text-slate-400 font-mono">{language}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCopy}
          className="text-slate-400 hover:text-white"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 mr-2" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </>
          )}
        </Button>
      </div>
      
      <div style={{ maxHeight }} className="overflow-auto">
        {highlighter ? (
          <highlighter.SyntaxHighlighter
            language={language}
            style={highlighter.style}
            showLineNumbers
            wrapLines
            lineProps={(lineNumber: number) => {
              const style: CSSProperties = { display: 'block' };
              if (highlightedLines.includes(lineNumber)) {
                style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                style.borderLeft = '3px solid rgb(239, 68, 68)';
                style.paddingLeft = '8px';
              }
              return { style };
            }}
            customStyle={{
              margin: 0,
              padding: '1rem',
              background: 'transparent',
              fontSize: '0.875rem',
            }}
          >
            {code}
          </highlighter.SyntaxHighlighter>
        ) : (
          <pre className="m-0 p-4 text-sm text-slate-300 overflow-auto">{code}</pre>
        )}
      </div>
    </div>
  );
}
