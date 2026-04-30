import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  Cpu,
  Database,
  HardDrive,
  Loader2,
  MemoryStick,
  Network,
  PlugZap,
  Server,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Layout } from "../components/Layout";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { TerminalLog, type TerminalLogEntry } from "../components/TerminalLog";
import { useAuth } from "../auth/AuthProvider";
import { ws, type ContainerMetricsPayload, type DomainEvent } from "../utils/api";
import { loadState, saveState } from "../utils/monitoringState";

interface MetricPoint {
  timestamp: number;
  label: string;
  cpuPercent: number | null;
  memoryMb: number | null;
}

interface MonitoringPersistedState {
  points: MetricPoint[];
  logs: TerminalLogEntry[];
  latestPayload: ContainerMetricsPayload | null;
}

const MAX_POINTS = 120;
const MONITORING_STATE_TTL_MS = 1000 * 60 * 60 * 6;

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "-";
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value > 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function Monitoring() {
  const navigate = useNavigate();
  const { jobId, containerId } = useParams<{
    jobId: string;
    containerId: string;
  }>();
  const { user } = useAuth();
  const stateKey =
    jobId && containerId ? `dqa:monitoring:${jobId}:${containerId}` : null;
  const persisted =
    stateKey != null
      ? loadState<MonitoringPersistedState>(stateKey, MONITORING_STATE_TTL_MS)
      : null;

  const [points, setPoints] = useState<MetricPoint[]>(persisted?.points ?? []);
  const [logs, setLogs] = useState<TerminalLogEntry[]>(persisted?.logs ?? []);
  const [latestPayload, setLatestPayload] = useState<ContainerMetricsPayload | null>(
    persisted?.latestPayload ?? null,
  );
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const pushLog = (entry: TerminalLogEntry) =>
    setLogs((prev) => [...prev.slice(-200), entry]);

  const latest = points[points.length - 1] ?? null;

  useEffect(() => {
    if (!user?.id || !containerId) return;
    const socket = ws.connectUserContainer(user.id, containerId);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      pushLog({ message: `Connected to ${containerId} metrics`, tone: "success" });
    };
    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as DomainEvent;
        if (parsed.event_name !== "container.metrics") {
          pushLog({
            message: `${parsed.event_name} (ignored)`,
            timestamp: parsed.timestamp,
            tone: "info",
          });
          return;
        }
        const payload = parsed.payload as ContainerMetricsPayload;
        setLatestPayload(payload);
        const cpu =
          typeof payload.cpu_percent === "number" ? payload.cpu_percent : null;
        const memBytes =
          typeof payload.memory_bytes === "number" ? payload.memory_bytes : null;
        const memoryMb = memBytes == null ? null : memBytes / (1024 * 1024);
        const ts = new Date(parsed.timestamp).getTime();
        setPoints((prev) => {
          const next = [
            ...prev,
            {
              timestamp: Number.isNaN(ts) ? Date.now() : ts,
              label: new Date(ts || Date.now()).toLocaleTimeString(),
              cpuPercent: cpu,
              memoryMb,
            },
          ];
          if (next.length > MAX_POINTS) return next.slice(-MAX_POINTS);
          return next;
        });
        pushLog({
          message: `cpu=${cpu ?? "-"}% memory=${formatBytes(memBytes)}`,
          timestamp: parsed.timestamp,
          tone: "info",
        });
      } catch {
        pushLog({ message: String(event.data), tone: "info" });
      }
    };
    socket.onerror = () => {
      setConnected(false);
      pushLog({ message: "Metrics stream error", tone: "error" });
      toast.error("Metrics stream error");
    };
    socket.onclose = () => {
      setConnected(false);
      pushLog({ message: "Metrics stream closed", tone: "warning" });
    };

    return () => {
      try {
        socket.close();
      } catch {
        // noop
      }
    };
  }, [user?.id, containerId]);

  useEffect(() => {
    if (!stateKey) return;
    saveState(stateKey, {
      points: points.slice(-MAX_POINTS),
      logs: logs.slice(-200),
      latestPayload,
    });
  }, [points, logs, latestPayload, stateKey]);

  const chartData = useMemo(() => points, [points]);
  const netTotals = latestPayload?.network?.totals;
  const ioStats = latestPayload?.io;
  const pids = latestPayload?.pids;
  const cpu = latestPayload?.cpu;
  const mem = latestPayload?.memory;
  const container = latestPayload?.container;
  const interfaces = useMemo(() => {
    const raw = latestPayload?.network?.interfaces;
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw).map(([name, value]) => ({
      name,
      data: typeof value === "object" && value ? (value as Record<string, unknown>) : {},
    }));
  }, [latestPayload]);

  if (!user?.id) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto py-16 flex flex-col items-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400 mb-4" />
          <p>Loading user context...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate(jobId ? `/execution?jobId=${jobId}` : "/history")}
          className="text-slate-400 hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-1 flex items-center gap-2">
              <Activity className="w-7 h-7 text-blue-400" /> Container monitoring
            </h1>
            <p className="text-slate-400 font-mono break-all">{containerId}</p>
            {jobId && (
              <p className="text-xs text-slate-500 mt-1">Analysis job: {jobId}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs ${
                connected
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-700 bg-slate-900 text-slate-400"
              }`}
            >
              <PlugZap className="w-3 h-3" />
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="p-5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-3 mb-2">
              <Cpu className="w-5 h-5 text-emerald-400" />
              <div className="text-sm text-slate-400">CPU usage</div>
            </div>
            <div className="text-3xl font-bold text-white">
              {latest?.cpuPercent != null
                ? `${latest.cpuPercent.toFixed(1)}%`
                : "-"}
            </div>
          </Card>
          <Card className="p-5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-3 mb-2">
              <MemoryStick className="w-5 h-5 text-purple-400" />
              <div className="text-sm text-slate-400">Memory</div>
            </div>
            <div className="text-3xl font-bold text-white">
              {latest?.memoryMb != null
                ? `${latest.memoryMb.toFixed(1)} MB`
                : "-"}
            </div>
          </Card>
          <Card className="p-5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-3 mb-2">
              <HardDrive className="w-5 h-5 text-blue-400" />
              <div className="text-sm text-slate-400">Samples received</div>
            </div>
            <div className="text-3xl font-bold text-white">{points.length}</div>
          </Card>
          <Card className="p-5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-3 mb-2">
              <Network className="w-5 h-5 text-cyan-400" />
              <div className="text-sm text-slate-400">Network totals</div>
            </div>
            <div className="text-sm text-slate-300">
              RX {formatBytes(netTotals?.rx_bytes)}
            </div>
            <div className="text-sm text-slate-300">
              TX {formatBytes(netTotals?.tx_bytes)}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="p-5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-3 mb-2">
              <Database className="w-5 h-5 text-orange-400" />
              <div className="text-sm text-slate-400">Block I/O</div>
            </div>
            <div className="text-sm text-slate-300">
              Read {formatBytes(ioStats?.read_bytes)}
            </div>
            <div className="text-sm text-slate-300">
              Write {formatBytes(ioStats?.write_bytes)}
            </div>
          </Card>
          <Card className="p-5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-3 mb-2">
              <HardDrive className="w-5 h-5 text-lime-400" />
              <div className="text-sm text-slate-400">Process / PIDs</div>
            </div>
            <div className="text-3xl font-bold text-white">
              {typeof pids?.current === "number" ? pids.current : "-"}
            </div>
          </Card>
          <Card className="p-5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-3 mb-2">
              <Server className="w-5 h-5 text-indigo-400" />
              <div className="text-sm text-slate-400">Container status</div>
            </div>
            <div className="text-sm text-slate-300">
              {container?.status ?? "-"} / health {container?.health_status ?? "-"}
            </div>
            <div className="text-sm text-slate-300">
              Restarts {container?.restart_count ?? "-"}
            </div>
          </Card>
        </div>

        <Card className="p-5 bg-slate-900 border-slate-800 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Container details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="text-slate-300">Name: {container?.name ?? "-"}</div>
            <div className="text-slate-300">Image: {container?.image ?? "-"}</div>
            <div className="text-slate-300">
              Started: {container?.started_at ? new Date(container.started_at).toLocaleString() : "-"}
            </div>
            <div className="text-slate-300">
              Mounts: {Array.isArray(container?.mounts) ? container?.mounts.length : 0}
            </div>
            <div className="text-slate-300">
              CPU throttled periods: {cpu?.throttling?.throttled_periods ?? "-"}
            </div>
            <div className="text-slate-300">
              Memory failcnt: {mem?.failcnt ?? "-"}
            </div>
          </div>
        </Card>

        <Card className="p-5 bg-slate-900 border-slate-800 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Network interfaces</h3>
          {interfaces.length === 0 ? (
            <div className="text-slate-500 text-sm">No network interface details yet.</div>
          ) : (
            <div className="space-y-2">
              {interfaces.map((iface) => (
                <div
                  key={iface.name}
                  className="border border-slate-800 bg-slate-950 rounded p-3 text-xs text-slate-300"
                >
                  <div className="font-semibold text-slate-200 mb-1">{iface.name}</div>
                  <div>RX bytes: {formatBytes(iface.data.rx_bytes as number | null | undefined)}</div>
                  <div>TX bytes: {formatBytes(iface.data.tx_bytes as number | null | undefined)}</div>
                  <div>
                    RX/TX packets: {String(iface.data.rx_packets ?? "-")} / {String(iface.data.tx_packets ?? "-")}
                  </div>
                  <div>
                    RX/TX errors: {String(iface.data.rx_errors ?? "-")} / {String(iface.data.tx_errors ?? "-")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5 bg-slate-900 border-slate-800 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">CPU (%)</h3>
          {chartData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-slate-500 text-sm">
              Waiting for first metrics event...
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="label"
                    stroke="#94a3b8"
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#0f172a",
                      border: "1px solid #1f2937",
                      color: "#e2e8f0",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cpuPercent"
                    stroke="#34d399"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5 bg-slate-900 border-slate-800 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Memory (MB)</h3>
          {chartData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-slate-500 text-sm">
              Waiting for first metrics event...
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="label"
                    stroke="#94a3b8"
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#0f172a",
                      border: "1px solid #1f2937",
                      color: "#e2e8f0",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="memoryMb"
                    stroke="#a855f7"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <TerminalLog
          logs={logs}
          title="Metrics event stream"
          emptyLabel="Waiting for events..."
          maxHeight="260px"
        />
      </div>
    </Layout>
  );
}
