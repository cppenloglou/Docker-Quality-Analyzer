import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { IssueList } from "./IssueCard";
import type { Issue } from "../utils/api";

interface IssueTabsProps {
  errors: Issue[];
  warnings: Issue[];
  securityIssues: Issue[];
  suggestions: Issue[];
  defaultTab?: string;
}

export function IssueTabs({
  errors,
  warnings,
  securityIssues,
  suggestions,
  defaultTab = "all",
}: IssueTabsProps) {
  const allIssues = [...errors, ...warnings, ...securityIssues, ...suggestions];

  return (
    <Tabs defaultValue={defaultTab} className="mb-6">
      <TabsList className="bg-slate-900 border border-slate-800">
        <TabsTrigger value="all">All Issues ({allIssues.length})</TabsTrigger>
        <TabsTrigger value="errors">Errors ({errors.length})</TabsTrigger>
        <TabsTrigger value="warnings">Warnings ({warnings.length})</TabsTrigger>
        <TabsTrigger value="security">Security ({securityIssues.length})</TabsTrigger>
        <TabsTrigger value="suggestions">Suggestions ({suggestions.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="all" className="mt-4">
        <IssueList issues={allIssues} />
      </TabsContent>
      <TabsContent value="errors" className="mt-4">
        <IssueList issues={errors} />
      </TabsContent>
      <TabsContent value="warnings" className="mt-4">
        <IssueList issues={warnings} />
      </TabsContent>
      <TabsContent value="security" className="mt-4">
        <IssueList issues={securityIssues} />
      </TabsContent>
      <TabsContent value="suggestions" className="mt-4">
        <IssueList issues={suggestions} />
      </TabsContent>
    </Tabs>
  );
}
