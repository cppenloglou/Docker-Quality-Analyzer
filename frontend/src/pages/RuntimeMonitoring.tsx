import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import {
  Activity,
  Cpu,
  MemoryStick,
  Network,
  HardDrive,
  ArrowLeft,
  PlayCircle,
  StopCircle,
  Timer,
} from "lucide-react";
import { generateRuntimeMetrics } from "../utils/mockData";
import { connectContainerMetricsSocket } from "../utils/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export function RuntimeMonitoring() {
  const navigate = useNavigate();
  const [isRunning, setIsRunning] = useState(true);
  const [metrics, setMetrics] = useState(generateRuntimeMetrics());
  const [cpuHistory, setCpuHistory] = useState<
    Array<{ time: string; value: number; id: number }>
  >([]);
  const [memoryHistory, setMemoryHistory] = useState<
    Array<{ time: string; value: number; id: number }>
  >([]);

  useEffect(() => {
    if (!isRunning) return;

    const containerId = sessionStorage.getItem("activeContainerId");
    const ws = containerId ? connectContainerMetricsSocket(containerId) : null;
    ws?.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data) as { payload?: Record<string, number> };
        const payload = data.payload || {};
        setMetrics((prev) => ({
          ...prev,
          cpu: Number(payload.cpu_percent ?? prev.cpu),
          memory: Math.round(Number(payload.memory_bytes ?? 0) / (1024 * 1024)) || prev.memory,
          networkRx: String(payload.network_rx ?? prev.networkRx),
        }));
      } catch {
        // keep interval fallback
      }
    });

    const interval = setInterval(() => {
      const newMetrics = generateRuntimeMetrics();
      setMetrics(newMetrics);

      const now = new Date();
      const timeStr = now
        .toLocaleTimeString("en-US", { hour12: false })
        .slice(0, 5);

      setCpuHistory((prev) => {
        const updated = [
          ...prev,
          {
            time: timeStr,
            value: newMetrics.cpu,
            id: Date.now() + Math.random(),
          },
        ];
        return updated.slice(-10); // Keep last 10 points
      });

      setMemoryHistory((prev) => {
        const updated = [
          ...prev,
          {
            time: timeStr,
            value: newMetrics.memory,
            id: Date.now() + Math.random() + 1000,
          },
        ];
        return updated.slice(-10);
      });
    }, 2000);

    return () => {
      clearInterval(interval);
      ws?.close();
    };
  }, [isRunning]);

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/image-analysis")}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Image Analysis
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">
                Container Runtime Monitoring
              </h1>
              <p className="text-slate-400 mt-2">
                Real-time resource usage and performance metrics
              </p>
            </div>
            <div className="flex gap-3">
              {isRunning ? (
                <Button
                  onClick={() => setIsRunning(false)}
                  variant="outline"
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                >
                  <StopCircle className="w-4 h-4 mr-2" />
                  Stop Container
                </Button>
              ) : (
                <Button
                  onClick={() => setIsRunning(true)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <PlayCircle className="w-4 h-4 mr-2" />
                  Start Container
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Container Status */}
        <Card className="p-6 bg-slate-900 border-slate-800 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <Activity className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">
                  my-node-app:latest
                </h2>
                <p className="text-sm text-slate-400">
                  Container ID:{" "}
                  <span className="text-blue-400 font-mono">c8f9d2a1b3e4</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-slate-400">Uptime</p>
                <p className="text-lg font-semibold text-white flex items-center gap-2">
                  <Timer className="w-4 h-4 text-blue-400" />
                  {formatUptime(metrics.uptime)}
                </p>
              </div>
              <Badge
                className={
                  isRunning
                    ? "bg-green-500/20 text-green-400 border-green-500/30"
                    : "bg-red-500/20 text-red-400 border-red-500/30"
                }
              >
                {isRunning ? "Running" : "Stopped"}
              </Badge>
            </div>
          </div>
        </Card>

        {/* Real-time Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {/* CPU Usage */}
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <Cpu className="w-6 h-6 text-blue-400" />
              </div>
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                Live
              </Badge>
            </div>
            <div>
              <p className="text-slate-400 text-sm mb-1">CPU Usage</p>
              <p className="text-3xl font-bold text-white mb-3">
                {metrics.cpu}%
              </p>
              <Progress value={metrics.cpu} className="h-2" />
            </div>
          </Card>

          {/* Memory Usage */}
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-purple-500/10 rounded-lg">
                <MemoryStick className="w-6 h-6 text-purple-400" />
              </div>
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                Live
              </Badge>
            </div>
            <div>
              <p className="text-slate-400 text-sm mb-1">Memory Usage</p>
              <p className="text-3xl font-bold text-white mb-1">
                {metrics.memory} MB
              </p>
              <p className="text-xs text-slate-500 mb-2">
                of {metrics.memoryLimit} MB
              </p>
              <Progress
                value={(metrics.memory / metrics.memoryLimit) * 100}
                className="h-2"
              />
            </div>
          </Card>

          {/* Network */}
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-green-500/10 rounded-lg">
                <Network className="w-6 h-6 text-green-400" />
              </div>
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                Live
              </Badge>
            </div>
            <div>
              <p className="text-slate-400 text-sm mb-2">Network I/O</p>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">RX:</span>
                  <span className="text-white font-medium">
                    {metrics.networkRx} KB/s
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">TX:</span>
                  <span className="text-white font-medium">
                    {metrics.networkTx} KB/s
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Disk I/O */}
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-orange-500/10 rounded-lg">
                <HardDrive className="w-6 h-6 text-orange-400" />
              </div>
              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                Live
              </Badge>
            </div>
            <div>
              <p className="text-slate-400 text-sm mb-2">Disk I/O</p>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Read:</span>
                  <span className="text-white font-medium">
                    {metrics.diskRead} MB/s
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Write:</span>
                  <span className="text-white font-medium">
                    {metrics.diskWrite} MB/s
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Historical Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* CPU History */}
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="w-5 h-5 text-blue-400" />
              <h3 className="text-lg font-semibold text-white">
                CPU Usage History
              </h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={cpuHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Memory History */}
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-2 mb-4">
              <MemoryStick className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-semibold text-white">
                Memory Usage History
              </h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={memoryHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} domain={[0, 512]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Container Info */}
        <Card className="p-6 bg-slate-900 border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-4">
            Container Details
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div>
                <p className="text-sm text-slate-400">Image</p>
                <p className="text-white font-mono">my-node-app:latest</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Container ID</p>
                <p className="text-white font-mono">c8f9d2a1b3e4</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Status</p>
                <p className="text-white">
                  {isRunning ? "Running" : "Stopped"}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-slate-400">Port Mapping</p>
                <p className="text-white font-mono">3000:3000</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Platform</p>
                <p className="text-white">linux/amd64</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Created</p>
                <p className="text-white">2 minutes ago</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex gap-4 mt-6">
          <Button
            onClick={() => navigate("/image-analysis")}
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Back to Image Analysis
          </Button>
          <Button
            onClick={() => navigate("/compose-monitoring")}
            className="bg-blue-600 hover:bg-blue-700"
          >
            View Compose Services
          </Button>
        </div>
      </div>
    </Layout>
  );
}
