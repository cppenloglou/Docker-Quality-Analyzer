import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DockerLoader, useMinLoader } from "../components/DockerLoader";
import { Layout } from "../components/Layout";
import { CodePreview } from "../components/CodePreview";
import { MotionPage } from "../components/motion";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { NativeSelectField } from "../components/ui/native-select";
import { cn } from "../components/ui/utils";
import {
  ApiError,
  research as researchApi,
  type JobStatus,
  type ResearchJob,
  type ResearchSummary,
} from "../utils/api";

const PAGE_SIZE = 20;

/** Secondary labels — muted tokens + SVG ticks can read as black-on-black */
const captionMuted = "text-slate-600 dark:text-slate-400";
const bodyMuted = "text-slate-700 dark:text-slate-300";
const tableTh =
  "whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300";

const pageShell =
  "relative mx-auto max-w-7xl px-4 pb-16 pt-2 sm:px-6 lg:px-8";

const panelCard =
  "rounded-2xl border border-border bg-card text-card-foreground shadow-sm";

const kpiShell =
  "group relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm motion-safe:transition-shadow motion-safe:duration-200 hover:shadow-md";

function shortUser(id: string) {
  return id.replace(/-/g, "").slice(0, 12);
}

function statusMixBadge(status: string) {
  switch (status) {
    case "done":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive dark:text-red-300";
    case "running":
      return "border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-200";
    case "queued":
      return "border-border bg-muted/80 text-slate-700 dark:text-slate-300";
    default:
      return "border-border bg-secondary text-secondary-foreground";
  }
}

function rowStatusBadge(status: string) {
  switch (status) {
    case "done":
      return "border-emerald-600/40 bg-emerald-600/15 text-emerald-800 dark:text-emerald-300";
    case "failed":
      return "border-destructive/40 bg-destructive/15 text-destructive dark:text-red-300";
    case "running":
      return "border-sky-600/40 bg-sky-600/15 text-sky-900 dark:text-sky-200";
    case "queued":
      return "border-border bg-muted text-slate-700 dark:text-slate-300";
    default:
      return "border-border bg-muted text-slate-700 dark:text-slate-300";
  }
}

function scoreTone(score: number | null | undefined): string {
  if (score == null) return captionMuted;
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ResearchAnalytics() {
  const dialogTitleId = useId();
  const dialogPanelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const [loading, setLoading] = useState(true);
  /** True while refetching after initial paint — avoids swapping the whole page for DockerLoader */
  const [refreshing, setRefreshing] = useState(false);
  const initialFetchCompletedRef = useRef(false);
  const ready = useMinLoader(!loading);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [rows, setRows] = useState<ResearchJob[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filterType, setFilterType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailJob, setDetailJob] = useState<ResearchJob | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadAll = useCallback(async () => {
    const isInitialPass = !initialFetchCompletedRef.current;
    if (isInitialPass) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    try {
      const [sum, page] = await Promise.all([
        researchApi.summary(90),
        researchApi.jobs({
          limit: PAGE_SIZE,
          offset,
          job_type: filterType || undefined,
          status: filterStatus || undefined,
        }),
      ]);
      setSummary(sum);
      setRows(page.items);
      setTotal(page.total);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load research data.";
      setError(message);
      toast.error(message);
    } finally {
      if (isInitialPass) {
        setLoading(false);
        initialFetchCompletedRef.current = true;
      } else {
        setRefreshing(false);
      }
    }
  }, [offset, filterType, filterStatus]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const chartRows = useMemo(
    () =>
      summary?.daily_buckets.map((b) => ({
        date: b.bucket_date,
        count: b.count,
      })) ?? [],
    [summary],
  );

  const maxBucket = useMemo(() => {
    if (!chartRows.length) return 1;
    return Math.max(...chartRows.map((b) => b.count), 1);
  }, [chartRows]);

  const hasActiveFilters = Boolean(filterType || filterStatus);

  /** Initial load uses full-page DockerLoader; filter/pagination refetch only sets this */
  const listBusy = loading || refreshing;

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailJob(null);
    window.setTimeout(() => triggerRef.current?.focus?.(), 0);
  }, []);

  useEffect(() => {
    if (!detailOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDetail();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogPanelRef.current;
      if (!root) return;
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (el) =>
          !el.closest("[data-recharts-tooltip-wrapper]") &&
          el.getClientRects().length > 0,
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [detailOpen, closeDetail]);

  useEffect(() => {
    if (!detailOpen) return;
    const t = window.setTimeout(() => {
      const root = dialogPanelRef.current;
      if (!root) return;
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (el) =>
          !el.closest("[data-recharts-tooltip-wrapper]") &&
          el.getClientRects().length > 0,
      );
      nodes[0]?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [detailOpen]);

  const openDetail = async (jobId: string) => {
    triggerRef.current = document.activeElement as HTMLElement;
    setDetailOpen(true);
    setDetailJob(null);
    setDetailLoading(true);
    try {
      const job = await researchApi.get(jobId);
      setDetailJob(job);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to load job detail.";
      toast.error(message);
      setDetailOpen(false);
      window.setTimeout(() => triggerRef.current?.focus?.(), 0);
    } finally {
      setDetailLoading(false);
    }
  };

  const sourceSnippet = (job: ResearchJob) => {
    const meta = job.input_metadata;
    const df =
      typeof meta.dockerfile_content === "string" ? meta.dockerfile_content : "";
    const comp =
      typeof meta.compose_content === "string" ? meta.compose_content : "";
    if (df) return { lang: "docker" as const, code: df };
    if (comp) return { lang: "yaml" as const, code: comp };
    return null;
  };

  if (!ready) {
    return (
      <Layout>
        <DockerLoader message="Loading research analytics..." fullScreen={false} />
      </Layout>
    );
  }

  return (
    <Layout>
      <MotionPage>
      <div className={pageShell}>
        <header
          className={cn(
            panelCard,
            "relative mb-10 overflow-hidden border-blue-500/15 bg-gradient-to-br from-card via-card to-blue-500/[0.06] p-8 sm:p-10",
          )}
        >
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl motion-reduce:blur-none"
            aria-hidden
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 flex-1 gap-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-500/10 shadow-inner">
                <FlaskConical className="h-7 w-7 text-blue-500 dark:text-blue-400" aria-hidden />
              </div>
              <div className="min-w-0 space-y-3">
                <p className={cn("text-xs font-semibold uppercase tracking-[0.2em]", captionMuted)}>
                  Research
                </p>
                <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Global analytics
                </h1>
                <p className={cn("max-w-2xl text-pretty text-base leading-relaxed", captionMuted)}>
                  Cross-tenant view of analysis jobs in this deployment—submitters,
                  filenames, embedded sources, and full results. Use filters and row
                  detail for cohort inspection.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3 lg:flex-col lg:items-stretch">
              <Button
                variant="outline"
                size="sm"
                className="h-11 gap-2 border-border bg-background/60 backdrop-blur-sm"
                disabled={listBusy}
                onClick={() => void loadAll()}
              >
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin motion-reduce:animate-none")} />
                Refresh data
              </Button>
              <p className={cn("flex items-center gap-2 text-xs lg:text-right", captionMuted)}>
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-500/90" aria-hidden />
                Trusted research context only
              </p>
            </div>
          </div>
        </header>

        {error ? (
          <div
            role="alert"
            className={cn(
              panelCard,
              "mb-8 flex flex-col gap-4 border-destructive/35 bg-destructive/10 p-5 sm:flex-row sm:items-center sm:justify-between",
            )}
          >
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="font-semibold text-destructive dark:text-red-200">
                  Could not load analytics
                </p>
                <p className="mt-1 text-sm text-destructive/90 dark:text-red-200/90">{error}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-11 shrink-0 border-destructive/40 bg-background/80"
              onClick={() => void loadAll()}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {summary ? (
          <>
            <section aria-label="Summary metrics" className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <article className={kpiShell}>
                <div className="absolute inset-y-3 left-0 w-1 rounded-full bg-blue-500/80" aria-hidden />
                <p className={cn("text-xs font-medium uppercase tracking-wide", captionMuted)}>
                  Total jobs
                </p>
                <p className="mt-3 font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                  {summary.total_jobs}
                </p>
                <p className={cn("mt-2 text-xs", captionMuted)}>All time in dataset</p>
              </article>
              <article className={kpiShell}>
                <p className={cn("text-xs font-medium uppercase tracking-wide", captionMuted)}>
                  Last 7 days
                </p>
                <p className="mt-3 font-mono text-3xl font-semibold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
                  {summary.jobs_last_7_days}
                </p>
                <p className={cn("mt-2 text-xs", captionMuted)}>Recent throughput</p>
              </article>
              <article className={kpiShell}>
                <p className={cn("text-xs font-medium uppercase tracking-wide", captionMuted)}>
                  Avg score
                </p>
                <p className="mt-3 font-mono text-3xl font-semibold tabular-nums tracking-tight text-amber-600 dark:text-amber-400">
                  {summary.avg_score != null ? summary.avg_score.toFixed(1) : "—"}
                </p>
                <p className={cn("mt-2 text-xs", captionMuted)}>Parsed where available</p>
              </article>
              <article className={kpiShell}>
                <p className={cn("text-xs font-medium uppercase tracking-wide", captionMuted)}>
                  By type
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(summary.count_by_type).map(([t, n]) => (
                    <Badge key={t} variant="outline" className="border-border font-normal">
                      <span className={captionMuted}>{t}</span>
                      <span className="ml-1 font-mono tabular-nums text-foreground">{n}</span>
                    </Badge>
                  ))}
                </div>
              </article>
            </section>

            <div className="mb-8 grid gap-4 lg:grid-cols-2">
              <Card className={cn(panelCard, "gap-0 p-6")}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-foreground">Status mix</h2>
                  <BarChart3 className={cn("h-4 w-4", captionMuted)} aria-hidden />
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(summary.count_by_status).map(([s, n]) => (
                    <Badge
                      key={s}
                      variant="outline"
                      className={cn("border font-normal", statusMixBadge(s))}
                    >
                      <span className="capitalize">{s}</span>
                      <span className="ml-1 font-mono tabular-nums">{n}</span>
                    </Badge>
                  ))}
                </div>
              </Card>
              <Card className={cn(panelCard, "gap-0 p-6")}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-foreground">Grade distribution</h2>
                  <span className={cn("text-xs", captionMuted)}>Quality bands</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(summary.grade_distribution).length === 0 ? (
                    <p className={cn("text-sm", captionMuted)}>
                      No graded results yet—scores will appear after grading runs.
                    </p>
                  ) : (
                    Object.entries(summary.grade_distribution).map(([g, n]) => (
                      <Badge
                        key={g}
                        variant="outline"
                        className="border-amber-500/30 font-normal text-amber-900 dark:text-amber-200"
                      >
                        <span className="font-semibold">{g}</span>
                        <span className="ml-1 font-mono tabular-nums opacity-90">{n}</span>
                      </Badge>
                    ))
                  )}
                </div>
              </Card>
            </div>

            <Card className={cn(panelCard, "mb-10 gap-0 p-6")}>
              <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Daily volume
                  </h2>
                  <p className={cn("text-xs", captionMuted)}>
                    Last {summary.daily_buckets.length} days · peak{" "}
                    <span className="font-mono tabular-nums text-foreground">{maxBucket}</span>{" "}
                    jobs
                  </p>
                </div>
              </div>
              <div className="h-[220px] w-full min-h-[200px] text-slate-600 dark:text-slate-300">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartRows}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="researchAreaFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(59 130 246)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="rgb(59 130 246)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="currentColor"
                      className="opacity-[0.35]"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "currentColor" }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={28}
                    />
                    <YAxis
                      width={36}
                      tick={{ fontSize: 11, fill: "currentColor" }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                      contentStyle={{
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        color: "var(--card-foreground)",
                        fontSize: "12px",
                        boxShadow: "0 10px 40px rgba(0,0,0,0.12)",
                      }}
                      labelFormatter={(label) => String(label)}
                      formatter={(value: number | string) => [
                        `${value} jobs`,
                        "Volume",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="rgb(59 130 246)"
                      strokeWidth={2}
                      fill="url(#researchAreaFill)"
                      dot={false}
                      activeDot={{
                        r: 4,
                        className: "fill-blue-500 stroke-background stroke-2",
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </>
        ) : null}

        <Card
          aria-busy={refreshing}
          className={cn(panelCard, "gap-0 overflow-hidden")}
        >
          <div className="border-b border-border bg-muted/30 px-6 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Job ledger</h2>
                <p className={cn("mt-1 text-sm", captionMuted)}>
                  Paginated records · open a row for full payload
                </p>
              </div>
              <div className="flex flex-col gap-8 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-10 sm:gap-y-6">
                <NativeSelectField
                  id="ra-filter-type"
                  label="Job type"
                  description="Which analyzer pipeline produced the row"
                  value={filterType}
                  disabled={listBusy}
                  onChange={(e) => {
                    setOffset(0);
                    setFilterType(e.target.value);
                  }}
                >
                  <option value="">All types</option>
                  <option value="dockerfile">Dockerfile</option>
                  <option value="compose">Compose</option>
                  <option value="project">Project archive</option>
                </NativeSelectField>
                <NativeSelectField
                  id="ra-filter-status"
                  label="Run status"
                  description="Queue or runtime phase"
                  value={filterStatus}
                  disabled={listBusy}
                  onChange={(e) => {
                    setOffset(0);
                    setFilterStatus(e.target.value);
                  }}
                >
                  <option value="">All statuses</option>
                  {( ["queued", "running", "done", "failed"] as JobStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </NativeSelectField>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full shrink-0 border-border bg-background sm:w-auto"
                  disabled={listBusy || !hasActiveFilters}
                  onClick={() => {
                    setFilterType("");
                    setFilterStatus("");
                    setOffset(0);
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)] backdrop-blur-md">
                <tr>
                  <th scope="col" className={cn(tableTh, "text-left")}>
                    Created
                  </th>
                  <th scope="col" className={cn(tableTh, "text-left")}>
                    Submitter
                  </th>
                  <th scope="col" className={cn(tableTh, "text-left")}>
                    Type
                  </th>
                  <th scope="col" className={cn(tableTh, "text-left")}>
                    Status
                  </th>
                  <th scope="col" className={cn(tableTh, "text-left")}>
                    File
                  </th>
                  <th scope="col" className={cn(tableTh, "text-right")}>
                    Score
                  </th>
                  <th scope="col" className={cn(tableTh, "w-[88px] text-right")}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((job) => (
                  <tr
                    key={job.id}
                    className="motion-safe:transition-colors motion-safe:duration-150 hover:bg-muted/40"
                  >
                    <td className={cn("whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums", bodyMuted)}>
                      {new Date(job.created_at).toLocaleString()}
                    </td>
                    <td className={cn("max-w-[120px] truncate px-4 py-3 font-mono text-xs", bodyMuted)} title={job.user_id}>
                      {shortUser(job.user_id)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="border-border font-normal capitalize">
                        {job.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={cn("font-normal capitalize", rowStatusBadge(job.status))}
                      >
                        {job.status}
                      </Badge>
                    </td>
                    <td
                      className={cn("max-w-[200px] truncate px-4 py-3", bodyMuted)}
                      title={String(job.input_metadata.filename ?? "")}
                    >
                      {typeof job.input_metadata.filename === "string"
                        ? job.input_metadata.filename
                        : "—"}
                    </td>
                    <td className={cn("px-4 py-3 text-right font-mono tabular-nums text-sm", scoreTone(job.score))}>
                      {job.score != null ? job.score : "—"}
                      {job.grade ? (
                        <span className={cn("ml-2 text-xs font-sans", captionMuted)}>
                          ({job.grade})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-11 min-w-[44px] rounded-lg font-medium text-blue-600 hover:bg-blue-500/10 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        onClick={() => void openDetail(job.id)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length === 0 && !listBusy ? (
            <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40">
                <BarChart3 className={cn("h-6 w-6", captionMuted)} aria-hidden />
              </div>
              <div className="max-w-sm space-y-2">
                <p className="text-base font-semibold text-foreground">No jobs match</p>
                <p className={cn("text-sm", captionMuted)}>
                  {hasActiveFilters
                    ? "Relax filters or reset to see the full ledger again."
                    : "Upload analyses from the home flow—records will land here automatically."}
                </p>
              </div>
              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => {
                    setFilterType("");
                    setFilterStatus("");
                    setOffset(0);
                  }}
                >
                  Reset filters
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-6 py-4">
            <span className={cn("text-xs tabular-nums", captionMuted)}>
              {total === 0 ? 0 : offset + 1}
              –
              {Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-11 w-11 border-border p-0"
                disabled={offset === 0 || listBusy}
                aria-label="Previous page"
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-11 w-11 border-border p-0"
                disabled={offset + PAGE_SIZE >= total || listBusy}
                aria-label="Next page"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {detailOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md dark:bg-black/70"
          role="presentation"
          onClick={closeDetail}
        >
          <div
            ref={dialogPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            tabIndex={-1}
            className={cn(
              panelCard,
              "flex max-h-[min(90vh,880px)] w-full max-w-3xl flex-col overflow-hidden shadow-xl outline-none",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div className="min-w-0 space-y-1">
                <p className={cn("text-xs font-medium uppercase tracking-wide", captionMuted)}>
                  Research detail
                </p>
                <h2 id={dialogTitleId} className="text-lg font-semibold tracking-tight text-foreground">
                  Job inspection
                </h2>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-11 w-11 shrink-0 rounded-lg p-0"
                aria-label="Close"
                onClick={closeDetail}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {detailLoading ? (
                <div className={cn("flex items-center gap-3 text-sm", captionMuted)}>
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                  Loading job payload…
                </div>
              ) : null}

              {!detailLoading && detailJob ? (
                <Tabs defaultValue="meta" className="gap-4">
                  <TabsList className="h-auto w-full flex-wrap justify-start gap-2 rounded-xl border border-border bg-muted/40 p-2">
                    <TabsTrigger value="meta" className="min-h-[44px] rounded-lg px-4">
                      Metadata
                    </TabsTrigger>
                    <TabsTrigger value="source" className="min-h-[44px] rounded-lg px-4">
                      Source
                    </TabsTrigger>
                    <TabsTrigger value="result" className="min-h-[44px] rounded-lg px-4">
                      Result JSON
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="meta" className="mt-4 space-y-4 text-sm outline-none">
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-border bg-muted/25 p-4">
                        <dt className={cn("text-xs font-medium uppercase tracking-wide", captionMuted)}>
                          Job ID
                        </dt>
                        <dd className="mt-2 break-all font-mono text-xs text-foreground">{detailJob.id}</dd>
                      </div>
                      <div className="rounded-xl border border-border bg-muted/25 p-4">
                        <dt className={cn("text-xs font-medium uppercase tracking-wide", captionMuted)}>
                          Submitter
                        </dt>
                        <dd className="mt-2 break-all font-mono text-xs text-foreground">{detailJob.user_id}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className={cn("text-xs font-medium uppercase tracking-wide", captionMuted)}>
                          Type / status
                        </dt>
                        <dd className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="outline" className="capitalize">{detailJob.type}</Badge>
                          <Badge variant="outline" className={cn("capitalize", rowStatusBadge(detailJob.status))}>
                            {detailJob.status}
                          </Badge>
                        </dd>
                      </div>
                    </dl>
                    <pre className="max-h-[42vh] overflow-auto rounded-xl border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground">
                      {JSON.stringify(detailJob.input_metadata, null, 2)}
                    </pre>
                  </TabsContent>

                  <TabsContent value="source" className="mt-4 outline-none">
                    {(() => {
                      const src = sourceSnippet(detailJob);
                      if (!src) {
                        return (
                          <p className={cn(
                            "rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm",
                            captionMuted,
                          )}>
                            No dockerfile or compose body stored on this job.
                          </p>
                        );
                      }
                      return (
                        <CodePreview code={src.code} language={src.lang} maxHeight="320px" />
                      );
                    })()}
                  </TabsContent>

                  <TabsContent value="result" className="mt-4 outline-none">
                    <pre className="max-h-[min(50vh,420px)] overflow-auto rounded-xl border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground">
                      {detailJob.result
                        ? JSON.stringify(detailJob.result, null, 2)
                        : "null"}
                    </pre>
                  </TabsContent>
                </Tabs>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-border bg-muted/20 px-6 py-4">
              <Button type="button" variant="outline" className="h-11 min-w-[96px]" onClick={closeDetail}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      </MotionPage>
    </Layout>
  );
}
