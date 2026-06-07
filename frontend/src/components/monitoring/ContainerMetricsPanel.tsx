import { useMemo, type ReactNode } from "react";
import {
  Activity,
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
  Network,
  Server,
} from "lucide-react";
import type { EChartsOption } from "echarts";

import { Card } from "../ui/card";
import { EChartPanel } from "./EChartPanel";
import type { ContainerMetricsPayload, RuntimeContainerState } from "../../utils/api";
import {
  formatBps,
  formatBytes,
  type MetricSample,
} from "../../utils/metricsSeries";

const SLATE_AXIS = "#94a3b8";
const SLATE_GRID = "#1e293b";
const TOOLTIP_BG = "#0f172a";
const TOOLTIP_BORDER = "#334155";

interface ContainerMetricsPanelProps {
  container: RuntimeContainerState | null;
  containerLabel: string;
  points: MetricSample[];
  latestPayload: ContainerMetricsPayload | null;
  connected: boolean;
  runtimeTerminal: boolean;
  reducedMotion: boolean;
  multiContainer: boolean;
}

function baseChartOption(reducedMotion: boolean): Pick<EChartsOption, "animation" | "textStyle"> {
  return {
    animation: !reducedMotion,
    textStyle: { color: SLATE_AXIS, fontSize: 10 },
  };
}

function axisDefaults(): EChartsOption {
  return {
    grid: { left: 48, right: 16, top: 28, bottom: 48 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      axisLine: { lineStyle: { color: SLATE_GRID } },
      axisLabel: { color: SLATE_AXIS, fontSize: 9, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      splitLine: { lineStyle: { color: SLATE_GRID, type: "dashed" } },
      axisLabel: { color: SLATE_AXIS, fontSize: 9 },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: TOOLTIP_BG,
      borderColor: TOOLTIP_BORDER,
      textStyle: { color: "#e2e8f0", fontSize: 11 },
    },
    dataZoom: [
      {
        type: "inside",
        start: 0,
        end: 100,
      },
      {
        type: "slider",
        height: 18,
        bottom: 4,
        borderColor: SLATE_GRID,
        fillerColor: "rgba(59, 130, 246, 0.15)",
        handleStyle: { color: "#64748b" },
        textStyle: { color: SLATE_AXIS, fontSize: 9 },
      },
    ],
  };
}

function ChartPlaceholder({ message }: { message: string }) {
  return (
    <div className="h-[200px] flex items-center justify-center text-slate-500 text-xs text-center px-4">
      {message}
    </div>
  );
}

export function ContainerMetricsPanel({
  container,
  containerLabel,
  points,
  latestPayload,
  connected,
  runtimeTerminal,
  reducedMotion,
  multiContainer,
}: ContainerMetricsPanelProps) {
  const latest = points[points.length - 1] ?? null;
  const netTotals = latestPayload?.network?.totals;
  const ioStats = latestPayload?.io;
  const pids = latestPayload?.pids;
  const meta = latestPayload?.container;
  const throttling = latestPayload?.cpu?.throttling;

  const statusMessage = useMemo(() => {
    if (!container) return "No container selected.";
    if (points.length === 0 && runtimeTerminal) {
      return "Container exited before metrics were collected.";
    }
    if (points.length === 0 && connected) return "Waiting for metrics…";
    if (points.length === 0) return "Waiting for metrics stream…";
    if (runtimeTerminal) return "Monitoring ended — showing last collected samples.";
    return null;
  }, [container, points.length, runtimeTerminal, connected]);

  const labels = useMemo(() => points.map((p) => p.label), [points]);

  const cpuOption = useMemo<EChartsOption>(
    () => ({
      ...baseChartOption(reducedMotion),
      ...axisDefaults(),
      xAxis: { ...axisDefaults().xAxis, data: labels },
      yAxis: {
        ...axisDefaults().yAxis,
        name: "%",
        nameTextStyle: { color: SLATE_AXIS, fontSize: 9 },
        min: 0,
      },
      series: [
        {
          name: "CPU",
          type: "line",
          smooth: true,
          showSymbol: false,
          areaStyle: { color: "rgba(52, 211, 153, 0.12)" },
          lineStyle: { color: "#34d399", width: 2 },
          itemStyle: { color: "#34d399" },
          data: points.map((p) => p.cpuPercent),
        },
      ],
      tooltip: {
        ...axisDefaults().tooltip,
        valueFormatter: (v) => (typeof v === "number" ? `${v.toFixed(2)}%` : "-"),
      },
    }),
    [labels, points, reducedMotion],
  );

  const memoryOption = useMemo<EChartsOption>(
    () => ({
      ...baseChartOption(reducedMotion),
      ...axisDefaults(),
      legend: {
        top: 0,
        textStyle: { color: SLATE_AXIS, fontSize: 10 },
      },
      xAxis: { ...axisDefaults().xAxis, data: labels },
      yAxis: [
        {
          type: "value",
          name: "MB",
          position: "left",
          min: 0,
          axisLine: { show: false },
          splitLine: { lineStyle: { color: SLATE_GRID, type: "dashed" } },
          axisLabel: { color: SLATE_AXIS, fontSize: 9 },
          nameTextStyle: { color: SLATE_AXIS, fontSize: 9 },
        },
        {
          type: "value",
          name: "%",
          position: "right",
          min: 0,
          max: 100,
          axisLine: { show: false },
          splitLine: { show: false },
          axisLabel: { color: SLATE_AXIS, fontSize: 9 },
          nameTextStyle: { color: SLATE_AXIS, fontSize: 9 },
        },
      ],
      series: [
        {
          name: "Memory MB",
          type: "line",
          smooth: true,
          showSymbol: false,
          yAxisIndex: 0,
          areaStyle: { color: "rgba(168, 85, 247, 0.12)" },
          lineStyle: { color: "#a855f7", width: 2 },
          data: points.map((p) => p.memoryMb),
        },
        {
          name: "Memory %",
          type: "line",
          smooth: true,
          showSymbol: false,
          yAxisIndex: 1,
          lineStyle: { color: "#818cf8", width: 1.5, type: "dashed" },
          data: points.map((p) => p.memoryPercent),
        },
      ],
    }),
    [labels, points, reducedMotion],
  );

  const networkOption = useMemo<EChartsOption>(
    () => ({
      ...baseChartOption(reducedMotion),
      ...axisDefaults(),
      legend: { top: 0, textStyle: { color: SLATE_AXIS, fontSize: 10 } },
      xAxis: { ...axisDefaults().xAxis, data: labels },
      yAxis: {
        ...axisDefaults().yAxis,
        axisLabel: {
          color: SLATE_AXIS,
          fontSize: 9,
          formatter: (v: number) => formatBytes(v),
        },
      },
      series: [
        {
          name: "RX",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: "#22d3ee", width: 2 },
          data: points.map((p) => p.rxBps),
        },
        {
          name: "TX",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: "#38bdf8", width: 2 },
          data: points.map((p) => p.txBps),
        },
      ],
      tooltip: {
        ...axisDefaults().tooltip,
        valueFormatter: (v) => formatBps(typeof v === "number" ? v : null),
      },
    }),
    [labels, points, reducedMotion],
  );

  const ioOption = useMemo<EChartsOption>(
    () => ({
      ...baseChartOption(reducedMotion),
      ...axisDefaults(),
      legend: { top: 0, textStyle: { color: SLATE_AXIS, fontSize: 10 } },
      xAxis: { ...axisDefaults().xAxis, data: labels },
      yAxis: {
        ...axisDefaults().yAxis,
        axisLabel: {
          color: SLATE_AXIS,
          fontSize: 9,
          formatter: (v: number) => formatBytes(v),
        },
      },
      series: [
        {
          name: "Read",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: "#fb923c", width: 2 },
          data: points.map((p) => p.readBps),
        },
        {
          name: "Write",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: "#fbbf24", width: 2 },
          data: points.map((p) => p.writeBps),
        },
      ],
      tooltip: {
        ...axisDefaults().tooltip,
        valueFormatter: (v) => formatBps(typeof v === "number" ? v : null),
      },
    }),
    [labels, points, reducedMotion],
  );

  const interfaces = useMemo(() => {
    const raw = latestPayload?.network?.interfaces;
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw).map(([name, data]) => ({
      name,
      data: (data ?? {}) as Record<string, unknown>,
    }));
  }, [latestPayload?.network?.interfaces]);

  if (!container) {
    return (
      <Card className="p-4 bg-slate-900 border-slate-800">
        <p className="text-xs text-slate-500">No container selected for metrics.</p>
      </Card>
    );
  }

  const showLiveBadge = connected && !runtimeTerminal && points.length > 0;

  return (
    <Card className="p-3 bg-slate-900 border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-xs font-semibold text-slate-400 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-blue-400" />
          Container metrics
          <span className="font-mono text-slate-500">{containerLabel}</span>
        </h3>
        <div className="flex items-center gap-2 text-[11px]">
          {multiContainer && (
            <span className="text-slate-500">Metrics follow the selected container above.</span>
          )}
          {showLiveBadge && <span className="text-emerald-400">streaming</span>}
          {runtimeTerminal && points.length > 0 && (
            <span className="text-slate-500">ended</span>
          )}
          {!runtimeTerminal && !connected && points.length === 0 && (
            <span className="text-slate-500">connecting…</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-3">
        <KpiCard icon={Cpu} iconClass="text-emerald-400" label="CPU %" value={latest?.cpuPercent != null ? `${latest.cpuPercent.toFixed(2)}%` : "-"} />
        <KpiCard
          icon={MemoryStick}
          iconClass="text-purple-400"
          label="Memory"
          value={
            latestPayload?.memory?.usage_bytes != null
              ? formatBytes(latestPayload.memory.usage_bytes)
              : "-"
          }
          sub={
            latest?.memoryPercent != null
              ? `${latest.memoryPercent.toFixed(1)}% of limit`
              : undefined
          }
        />
        <KpiCard
          icon={Network}
          iconClass="text-cyan-400"
          label="Net RX / TX"
          value={`${formatBytes(netTotals?.rx_bytes)} / ${formatBytes(netTotals?.tx_bytes)}`}
        />
        <KpiCard
          icon={Database}
          iconClass="text-orange-400"
          label="I/O R / W"
          value={`${formatBytes(ioStats?.read_bytes)} / ${formatBytes(ioStats?.write_bytes)}`}
        />
        <KpiCard
          icon={HardDrive}
          iconClass="text-lime-400"
          label="PIDs"
          value={typeof pids?.current === "number" ? String(pids.current) : "-"}
        />
        <KpiCard
          icon={Server}
          iconClass="text-indigo-400"
          label="Status"
          value={`${meta?.status ?? container.status ?? "-"} / ${meta?.health_status ?? container.health_status ?? "-"}`}
        />
        <KpiCard
          icon={Activity}
          iconClass="text-amber-400"
          label="CPU throttle"
          value={
            throttling
              ? `${throttling.throttled_periods ?? 0}/${throttling.periods ?? 0}`
              : "-"
          }
        />
        <KpiCard
          icon={Activity}
          iconClass="text-slate-400"
          label="Samples"
          value={String(points.length)}
        />
      </div>

      {statusMessage && points.length === 0 ? (
        <ChartPlaceholder message={statusMessage} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          <ChartCard title="CPU (%)">
            {points.length === 0 ? (
              <ChartPlaceholder message={statusMessage ?? "Waiting for metrics…"} />
            ) : (
              <EChartPanel option={cpuOption} height={200} aria-label="CPU usage over time" />
            )}
          </ChartCard>
          <ChartCard title="Memory (MB / %)">
            {points.length === 0 ? (
              <ChartPlaceholder message={statusMessage ?? "Waiting for metrics…"} />
            ) : (
              <EChartPanel option={memoryOption} height={200} aria-label="Memory usage over time" />
            )}
          </ChartCard>
          <ChartCard title="Network throughput">
            {points.length < 2 ? (
              <ChartPlaceholder message="Need at least 2 samples for throughput rates." />
            ) : (
              <EChartPanel option={networkOption} height={200} aria-label="Network throughput over time" />
            )}
          </ChartCard>
          <ChartCard title="Block I/O throughput">
            {points.length < 2 ? (
              <ChartPlaceholder message="Need at least 2 samples for throughput rates." />
            ) : (
              <EChartPanel option={ioOption} height={200} aria-label="Block I/O throughput over time" />
            )}
          </ChartCard>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="p-3 bg-slate-950 border-slate-800">
          <h4 className="text-xs font-semibold text-slate-400 mb-2">Container</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-slate-500">Name</dt>
            <dd className="text-slate-300 font-mono truncate">{meta?.name ?? container.name ?? "-"}</dd>
            <dt className="text-slate-500">Image</dt>
            <dd className="text-slate-300 font-mono truncate">{meta?.image ?? container.image ?? "-"}</dd>
            <dt className="text-slate-500">IP</dt>
            <dd className="text-slate-300 font-mono">{meta?.ip_address ?? "-"}</dd>
            <dt className="text-slate-500">Started</dt>
            <dd className="text-slate-300 font-mono">
              {meta?.started_at ? new Date(meta.started_at).toLocaleString() : "-"}
            </dd>
            <dt className="text-slate-500">Restarts</dt>
            <dd className="text-slate-300 font-mono">{meta?.restart_count ?? container.restart_count ?? "-"}</dd>
            <dt className="text-slate-500">Mounts</dt>
            <dd className="text-slate-300 font-mono">
              {Array.isArray(meta?.mounts) ? meta.mounts.length : 0}
            </dd>
          </dl>
        </Card>
        <Card className="p-3 bg-slate-950 border-slate-800">
          <h4 className="text-xs font-semibold text-slate-400 mb-2">Ports</h4>
          {!meta?.ports?.length ? (
            <p className="text-slate-500 text-xs">No port mappings.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto text-xs font-mono">
              {meta.ports.map((p, i) => (
                <div key={i} className="border border-slate-800 bg-slate-900 rounded px-2 py-1">
                  <span className="text-slate-400">{p.container_port}</span>
                  {p.host_bindings && p.host_bindings.length > 0 && (
                    <span className="text-slate-300">
                      {" → "}
                      {p.host_bindings.map((b, j) => (
                        <span key={j}>
                          {b.host_ip || "0.0.0.0"}:{b.host_port}
                          {j < (p.host_bindings?.length ?? 0) - 1 ? ", " : ""}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-3 bg-slate-950 border-slate-800">
          <h4 className="text-xs font-semibold text-slate-400 mb-2">Network interfaces</h4>
          {interfaces.length === 0 ? (
            <p className="text-slate-500 text-xs">No per-interface data yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {interfaces.map((iface) => (
                <div key={iface.name} className="border border-slate-800 bg-slate-900 rounded p-2 text-xs">
                  <div className="font-semibold text-slate-200 mb-0.5">{iface.name}</div>
                  <div className="grid grid-cols-2 gap-x-3 text-slate-400">
                    <span>RX: {formatBytes(iface.data.rx_bytes as number | undefined)}</span>
                    <span>TX: {formatBytes(iface.data.tx_bytes as number | undefined)}</span>
                    <span>
                      Pkts: {String(iface.data.rx_packets ?? "-")}/{String(iface.data.tx_packets ?? "-")}
                    </span>
                    <span>
                      Err: {String(iface.data.rx_errors ?? "-")}/{String(iface.data.tx_errors ?? "-")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Card>
  );
}

function KpiCard({
  icon: Icon,
  iconClass,
  label,
  value,
  sub,
}: {
  icon: typeof Cpu;
  iconClass: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="p-2.5 bg-slate-950 border-slate-800">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${iconClass}`} />
        <span className="text-[10px] text-slate-400">{label}</span>
      </div>
      <div className="text-xs font-bold text-white font-mono truncate" title={value}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-3 bg-slate-950 border-slate-800">
      <h4 className="text-xs font-semibold text-slate-400 mb-2">{title}</h4>
      {children}
    </Card>
  );
}
