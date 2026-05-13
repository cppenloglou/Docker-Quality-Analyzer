import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  Cpu,
  Database,
  HardDrive,
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
import { DockerLoader } from "../components/DockerLoader";
import { TerminalLog, type TerminalLogEntry } from "../components/TerminalLog";
import { useAuth } from "../auth/AuthProvider";
import { MotionPage, StaggerList, StaggerItem } from "../components/motion";
import { motion, useReducedMotion } from "motion/react";
import {
  compose as composeApi,
  ws,
  type ContainerMetricsPayload,
  type DomainEvent,
} from "../utils/api";
import { loadState, saveState } from "../utils/monitoringState";

interface MetricPoint {
  timestamp: number;
  label: string;
  cpuPercent: number | null;
  memoryMb: number | null;
}

interface ContainerState {
  points: MetricPoint[];
  logs: TerminalLogEntry[];
  latestPayload: ContainerMetricsPayload | null;
  connected: boolean;
}

interface MonitoringPersistedState {
  containerStates: Record<string, { points: MetricPoint[]; logs: TerminalLogEntry[]; latestPayload: ContainerMetricsPayload | null }>;
  selectedContainerId: string | null;
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
  return `${value.toFixed(2)} ${units[unit]}`;
}

export function Monitoring() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { jobId, containerId: routeContainerId } = useParams<{
    jobId: string;
    containerId?: string;
  }>();
  const { user } = useAuth();
  const stateKey = jobId ? `dqa:monitoring:${jobId}` : null;
  const persisted =
    stateKey != null
      ? loadState<MonitoringPersistedState>(stateKey, MONITORING_STATE_TTL_MS)
      : null;

  const [containerIds, setContainerIds] = useState<string[]>([]);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(
    routeContainerId ?? persisted?.selectedContainerId ?? null,
  );
  const [containerStates, setContainerStates] = useState<Record<string, ContainerState>>(() => {
    const initial: Record<string, ContainerState> = {};
    if (persisted?.containerStates) {
      for (const [id, s] of Object.entries(persisted.containerStates)) {
        initial[id] = { ...s, connected: false };
      }
    }
    return initial;
  });
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await composeApi.deployStatus(jobId);
        if (cancelled) return;
        if (status.active && status.container_ids.length > 0) {
          setContainerIds(status.container_ids);
          if (!selectedContainerId || !status.container_ids.includes(selectedContainerId)) {
            setSelectedContainerId(status.container_ids[0]);
          }
        } else if (routeContainerId) {
          setContainerIds([routeContainerId]);
          setSelectedContainerId(routeContainerId);
        }
      } catch {
        if (routeContainerId) {
          setContainerIds([routeContainerId]);
          setSelectedContainerId(routeContainerId);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [jobId, routeContainerId]);

  useEffect(() => {
    if (!user?.id || containerIds.length === 0) return;

    const existingSockets = socketsRef.current;
    for (const cid of containerIds) {
      if (existingSockets.has(cid)) continue;

      const socket = ws.connectUserContainer(user.id, cid);
      existingSockets.set(cid, socket);

      socket.onopen = () => {
        setContainerStates((prev) => ({
          ...prev,
          [cid]: {
            ...(prev[cid] ?? { points: [], logs: [], latestPayload: null, connected: false }),
            connected: true,
            logs: [...(prev[cid]?.logs ?? []), { message: `Connected to ${cid.slice(0, 12)}`, tone: "success" as const }],
          },
        }));
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as DomainEvent;
          if (parsed.event_name !== "container.metrics") return;
          const payload = parsed.payload as ContainerMetricsPayload;
          const cpu = typeof payload.cpu_percent === "number" ? payload.cpu_percent : null;
          const memBytes = typeof payload.memory_bytes === "number" ? payload.memory_bytes : null;
          const memoryMb = memBytes == null ? null : memBytes / (1024 * 1024);
          const ts = new Date(parsed.timestamp).getTime();

          setContainerStates((prev) => {
            const existing = prev[cid] ?? { points: [], logs: [], latestPayload: null, connected: true };
            const nextPoints = [
              ...existing.points,
              {
                timestamp: Number.isNaN(ts) ? Date.now() : ts,
                label: new Date(ts || Date.now()).toLocaleTimeString(),
                cpuPercent: cpu,
                memoryMb,
              },
            ].slice(-MAX_POINTS);
            return {
              ...prev,
              [cid]: {
                ...existing,
                latestPayload: payload,
                points: nextPoints,
                logs: [...existing.logs.slice(-200), { message: `cpu_percent=${cpu ?? "null"} memory_bytes=${memBytes ?? "null"} memory_percent=${payload.memory_percent ?? "null"}`, timestamp: parsed.timestamp, tone: "info" as const }],
              },
            };
          });
        } catch {
          // ignore parse errors
        }
      };

      socket.onerror = () => {
        setContainerStates((prev) => ({
          ...prev,
          [cid]: {
            ...(prev[cid] ?? { points: [], logs: [], latestPayload: null, connected: false }),
            connected: false,
          },
        }));
        toast.error(`Stream error: ${cid.slice(0, 12)}`);
      };

      socket.onclose = () => {
        setContainerStates((prev) => ({
          ...prev,
          [cid]: {
            ...(prev[cid] ?? { points: [], logs: [], latestPayload: null, connected: false }),
            connected: false,
          },
        }));
        existingSockets.delete(cid);
      };
    }

    return () => {
      for (const [, socket] of existingSockets) {
        try { socket.close(); } catch { /* noop */ }
      }
      existingSockets.clear();
    };
  }, [user?.id, containerIds]);

  useEffect(() => {
    if (!stateKey) return;
    const persistable: MonitoringPersistedState["containerStates"] = {};
    for (const [id, s] of Object.entries(containerStates)) {
      persistable[id] = {
        points: s.points.slice(-MAX_POINTS),
        logs: s.logs.slice(-200),
        latestPayload: s.latestPayload,
      };
    }
    saveState(stateKey, { containerStates: persistable, selectedContainerId });
  }, [containerStates, selectedContainerId, stateKey]);

  const currentState: ContainerState | null = selectedContainerId
    ? containerStates[selectedContainerId] ?? null
    : null;

  const chartData = useMemo(() => currentState?.points ?? [], [currentState?.points]);
  const latestPayload = currentState?.latestPayload ?? null;
  const connected = currentState?.connected ?? false;
  const latest = chartData[chartData.length - 1] ?? null;
  const netTotals = latestPayload?.network?.totals;
  const ioStats = latestPayload?.io;
  const pids = latestPayload?.pids;
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
        <DockerLoader message="Loading monitoring..." fullScreen={false} />
      </Layout>
    );
  }

  return (
    <Layout>
      <MotionPage>
      <div className="w-full max-w-[1600px] mx-auto px-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(jobId ? `/execution?jobId=${jobId}` : "/history")}
              className="text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-400" /> Monitoring
            </h1>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs ${
              connected
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-slate-700 bg-slate-900 text-slate-400"
            }`}
          >
            <PlugZap className="w-3 h-3" />
            {connected ? "Live" : "Disconnected"}
          </span>
        </div>

        {containerIds.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {containerIds.map((cid) => {
              const isSelected = cid === selectedContainerId;
              const cState = containerStates[cid];
              const isConnected = cState?.connected ?? false;
              return (
                <button
                  key={cid}
                  onClick={() => setSelectedContainerId(cid)}
                  className={`px-2 py-1 rounded border text-xs font-mono transition-colors ${
                    isSelected
                      ? "border-blue-500 bg-blue-500/20 text-blue-200"
                      : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isConnected ? "bg-emerald-400" : "bg-slate-600"
                      }`}
                    />
                    {cState?.latestPayload?.container?.name || cid.slice(0, 12)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <StaggerList className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
          <StaggerItem>
          <Card className="p-2.5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-1.5 mb-1">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-slate-400">CPU %</span>
            </div>
            <div className="text-sm font-bold text-white font-mono">
              {latest?.cpuPercent != null ? `${latest.cpuPercent}` : "-"}
            </div>
          </Card>
          </StaggerItem>
          <StaggerItem>
          <Card className="p-2.5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-1.5 mb-1">
              <MemoryStick className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs text-slate-400">Mem bytes</span>
            </div>
            <div className="text-sm font-bold text-white font-mono">
              {latestPayload?.memory_bytes != null ? `${latestPayload.memory_bytes}` : "-"}
            </div>
          </Card>
          </StaggerItem>
          <StaggerItem>
          <Card className="p-2.5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-1.5 mb-1">
              <Network className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs text-slate-400">Net RX / TX</span>
            </div>
            <div className="text-xs text-slate-300 font-mono">
              {netTotals?.rx_bytes ?? "-"} / {netTotals?.tx_bytes ?? "-"}
            </div>
          </Card>
          </StaggerItem>
          <StaggerItem>
          <Card className="p-2.5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-1.5 mb-1">
              <Database className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-xs text-slate-400">I/O R / W</span>
            </div>
            <div className="text-xs text-slate-300 font-mono">
              {ioStats?.read_bytes ?? "-"} / {ioStats?.write_bytes ?? "-"}
            </div>
          </Card>
          </StaggerItem>
          <StaggerItem>
          <Card className="p-2.5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-1.5 mb-1">
              <HardDrive className="w-3.5 h-3.5 text-lime-400" />
              <span className="text-xs text-slate-400">PIDs</span>
            </div>
            <div className="text-sm font-bold text-white font-mono">
              {typeof pids?.current === "number" ? pids.current : "-"}
            </div>
          </Card>
          </StaggerItem>
          <StaggerItem>
          <Card className="p-2.5 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-1.5 mb-1">
              <Server className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs text-slate-400">Status</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-300 font-mono">
              {currentState?.connected && (
                <motion.span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"
                  animate={reducedMotion ? {} : { scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              {container?.status ?? "-"} / {container?.health_status ?? "-"}
            </div>
          </Card>
          </StaggerItem>
        </StaggerList>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-3">
          <Card className="p-3 bg-slate-900 border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 mb-2">CPU (%)</h3>
            {chartData.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-slate-500 text-xs">
                Waiting for metrics...
              </div>
            ) : (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 9 }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 9 }} />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", color: "#e2e8f0", fontSize: 11 }}
                      formatter={(value: number) => [`${value.toFixed(4)}%`, "CPU"]}
                    />
                    <Line type="monotone" dataKey="cpuPercent" stroke="#34d399" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          <Card className="p-3 bg-slate-900 border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 mb-2">Memory (MB)</h3>
            {chartData.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-slate-500 text-xs">
                Waiting for metrics...
              </div>
            ) : (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 9 }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 9 }} />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", color: "#e2e8f0", fontSize: 11 }}
                      formatter={(value: number) => [`${value.toFixed(4)} MB`, "Memory"]}
                    />
                    <Line type="monotone" dataKey="memoryMb" stroke="#a855f7" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mb-3">
          <Card className="p-3 bg-slate-900 border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 mb-2">Container</h3>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <span className="text-slate-500">Name</span>
              <span className="text-slate-300 font-mono truncate">{container?.name ?? "-"}</span>
              <span className="text-slate-500">Image</span>
              <span className="text-slate-300 font-mono truncate">{container?.image ?? "-"}</span>
              <span className="text-slate-500">IP</span>
              <span className="text-slate-300 font-mono">{container?.ip_address || "-"}</span>
              <span className="text-slate-500">Started</span>
              <span className="text-slate-300 font-mono">{container?.started_at ? new Date(container.started_at).toLocaleString() : "-"}</span>
              <span className="text-slate-500">Restarts</span>
              <span className="text-slate-300 font-mono">{container?.restart_count ?? "-"}</span>
              <span className="text-slate-500">Mounts</span>
              <span className="text-slate-300 font-mono">{Array.isArray(container?.mounts) ? container?.mounts.length : 0}</span>
              <span className="text-slate-500">Samples</span>
              <span className="text-slate-300 font-mono">{chartData.length}</span>
            </div>
          </Card>
          <Card className="p-3 bg-slate-900 border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 mb-2">Ports</h3>
            {!container?.ports || container.ports.length === 0 ? (
              <div className="text-slate-500 text-xs">No port mappings.</div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto text-xs font-mono">
                {container.ports.map((p, i) => (
                  <div key={i} className="border border-slate-800 bg-slate-950 rounded px-2 py-1">
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
          <Card className="p-3 bg-slate-900 border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 mb-2">Network interfaces</h3>
            {interfaces.length === 0 ? (
              <div className="text-slate-500 text-xs">No data yet.</div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {interfaces.map((iface) => (
                  <div key={iface.name} className="border border-slate-800 bg-slate-950 rounded p-2 text-xs">
                    <div className="font-semibold text-slate-200 mb-0.5">{iface.name}</div>
                    <div className="grid grid-cols-2 gap-x-3 text-slate-400">
                      <span>RX: {formatBytes(iface.data.rx_bytes as number | null | undefined)}</span>
                      <span>TX: {formatBytes(iface.data.tx_bytes as number | null | undefined)}</span>
                      <span>Pkts: {String(iface.data.rx_packets ?? "-")}/{String(iface.data.tx_packets ?? "-")}</span>
                      <span>Err: {String(iface.data.rx_errors ?? "-")}/{String(iface.data.tx_errors ?? "-")}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <TerminalLog
          logs={currentState?.logs ?? []}
          title="Metrics stream"
          emptyLabel="Waiting for events..."
          maxHeight="200px"
        />
      </div>
      </MotionPage>
    </Layout>
  );
}
