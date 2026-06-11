import { AlertCircle, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import type { Issue } from "../utils/api";

export function isSecurityIssue(issue: Issue): boolean {
  return issue.code.startsWith("SEC");
}

export function IssueCard({ issue }: { issue: Issue }) {
  const security = isSecurityIssue(issue);
  return (
    <Card className="p-4 bg-slate-900 border-slate-800">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-1">
          {security ? (
            <div className="p-2 bg-purple-500/10 rounded">
              <ShieldAlert className="w-5 h-5 text-purple-400" />
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="border-slate-700 text-slate-400">
              Line {issue.line}
            </Badge>
            <Badge variant="outline" className="border-slate-700 text-slate-400 font-mono text-xs">
              {issue.code}
            </Badge>
            <Badge
              className={
                security
                  ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                  : issue.severity === "error"
                    ? "bg-red-500/20 text-red-400 border-red-500/30"
                    : issue.severity === "warning"
                      ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                      : "bg-blue-500/20 text-blue-400 border-blue-500/30"
              }
            >
              {security ? "SECURITY" : issue.severity.toUpperCase()}
            </Badge>
          </div>

          <h4 className="text-white font-medium mb-2">{issue.message}</h4>

          {(issue.suggestion || issue.doc_url) && (
            <div className="bg-slate-950 border border-slate-800 rounded p-3 mt-3">
              <div className="text-sm text-green-400 mb-1">Recommended Fix</div>
              {issue.suggestion && (
                <p className="text-sm text-slate-300">{issue.suggestion}</p>
              )}
              {issue.doc_url && (
                <a
                  href={issue.doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-sm text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline mt-2"
                >
                  Rule documentation
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function EmptyIssues() {
  return (
    <Card className="p-8 bg-slate-900 border-slate-800 text-center">
      <AlertCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
      <p className="text-slate-400">No issues found in this category</p>
    </Card>
  );
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return <EmptyIssues />;
  return (
    <div className="space-y-3">
      {issues.map((issue, i) => (
        <IssueCard key={i} issue={issue} />
      ))}
    </div>
  );
}
