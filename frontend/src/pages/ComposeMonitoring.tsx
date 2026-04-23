import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  Server,
  Cpu,
  MemoryStick,
  ArrowLeft,
  StopCircle,
  Terminal,
  Activity,
} from "lucide-react";
import { generateServiceMetrics } from "../utils/mockData";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ServiceMetrics {
  name: string;
  status: string;
  cpu: number;
  memory: number;
  networkRx: string;
  networkTx: string;
  uptime: number;
}

export function ComposeMonitoring() {
  const navigate = useNavigate();
  const [services, setServices] = useState<ServiceMetrics[]>([
    generateServiceMetrics("web"),
    generateServiceMetrics("api"),
    generateServiceMetrics("db"),
  ]);
  const [selectedService, setSelectedService] = useState("web");
  const logs: { [key: string]: string[] } = {
    web: [
      "[nginx] Starting nginx server...",
      "[nginx] Server listening on port 80",
      "[nginx] Worker process started",
      '192.168.1.1 - - [13/Mar/2026:10:30:15 +0000] "GET / HTTP/1.1" 200 612',
      '192.168.1.2 - - [13/Mar/2026:10:30:18 +0000] "GET /api HTTP/1.1" 200 342',
    ],
    api: [
      "[app] Starting Node.js application...",
      "[app] Connected to database successfully",
      "[app] API server listening on port 3000",
      "[app] GET /api/users 200 45ms",
      "[app] POST /api/data 201 78ms",
    ],
    db: [
      "[postgres] Database cluster directory /var/lib/postgresql/data",
      "[postgres] Starting PostgreSQL 15.3",
      "[postgres] Database system is ready to accept connections",
      "[postgres] Checkpoint starting",
      "[postgres] Checkpoint complete",
    ],
  };

  useEffect(() => {
    // Update metrics every 3 seconds
    const interval = setInterval(() => {
      setServices([
        generateServiceMetrics("web"),
        generateServiceMetrics("api"),
        generateServiceMetrics("db"),
      ]);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const serviceIcons: { [key: string]: string } = {
    web: "🌐",
    api: "⚡",
    db: "🗄️",
  };

  const serviceColors: { [key: string]: string } = {
    web: "blue",
    api: "purple",
    db: "green",
  };

  const comparisonData = services.map((service) => ({
    name: service.name.toUpperCase(),
    cpu: service.cpu,
    memory: service.memory,
    id: service.name, // Add unique identifier
  }));

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/runtime-monitoring")}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Runtime Monitoring
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">
                Docker Compose Services
              </h1>
              <p className="text-slate-400 mt-2">
                Monitor all services in your Docker Compose stack
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <Activity className="w-4 h-4 mr-2" />
                View Logs
              </Button>
              <Button
                variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                Stop All
              </Button>
            </div>
          </div>
        </div>

        {/* Services Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {services.map((service, index) => {
            const color = serviceColors[service.name];
            return (
              <Card
                key={index}
                className={`p-6 bg-slate-900 border-slate-800 cursor-pointer transition-all ${
                  selectedService === service.name
                    ? `ring-2 ring-${color}-500`
                    : ""
                }`}
                onClick={() => setSelectedService(service.name)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="text-3xl">{serviceIcons[service.name]}</div>
                    <div>
                      <h3 className="text-lg font-semibold text-white capitalize">
                        {service.name}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {service.name === "web" && "nginx:alpine"}
                        {service.name === "api" && "node:18-alpine"}
                        {service.name === "db" && "postgres:15-alpine"}
                      </p>
                    </div>
                  </div>
                  <Badge
                    className={`bg-green-500/20 text-green-400 border-green-500/30`}
                  >
                    {service.status}
                  </Badge>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">CPU</span>
                      <span className="text-white font-medium">
                        {service.cpu}%
                      </span>
                    </div>
                    <Progress value={service.cpu} className="h-1.5" />
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Memory</span>
                      <span className="text-white font-medium">
                        {service.memory} MB
                      </span>
                    </div>
                    <Progress
                      value={(service.memory / 512) * 100}
                      className="h-1.5"
                    />
                  </div>

                  <div className="pt-2 border-t border-slate-800">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Network RX/TX</span>
                      <span className="text-slate-400">
                        {service.networkRx}/{service.networkTx} KB/s
                      </span>
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-slate-500">Uptime</span>
                      <span className="text-slate-400">
                        {formatUptime(service.uptime)}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Resource Comparison Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="w-5 h-5 text-blue-400" />
              <h3 className="text-lg font-semibold text-white">
                CPU Usage Comparison
              </h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Bar
                  dataKey="cpu"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-2 mb-4">
              <MemoryStick className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-semibold text-white">
                Memory Usage Comparison
              </h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Bar
                  dataKey="memory"
                  fill="#8b5cf6"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Service Details Tabs */}
        <Card className="bg-slate-900 border-slate-800">
          <Tabs
            defaultValue="web"
            value={selectedService}
            onValueChange={setSelectedService}
          >
            <div className="p-4 border-b border-slate-800">
              <TabsList className="bg-slate-950">
                <TabsTrigger
                  value="web"
                  className="data-[state=active]:bg-slate-800"
                >
                  <Server className="w-4 h-4 mr-2" />
                  Web
                </TabsTrigger>
                <TabsTrigger
                  value="api"
                  className="data-[state=active]:bg-slate-800"
                >
                  <Server className="w-4 h-4 mr-2" />
                  API
                </TabsTrigger>
                <TabsTrigger
                  value="db"
                  className="data-[state=active]:bg-slate-800"
                >
                  <Server className="w-4 h-4 mr-2" />
                  Database
                </TabsTrigger>
              </TabsList>
            </div>

            {services.map((service) => (
              <TabsContent
                key={service.name}
                value={service.name}
                className="p-0"
              >
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
                  {/* Service Info */}
                  <Card className="p-4 bg-slate-950 border-slate-800">
                    <h4 className="text-sm font-semibold text-white mb-3">
                      Service Info
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Status</span>
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                          {service.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">CPU</span>
                        <span className="text-white">{service.cpu}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Memory</span>
                        <span className="text-white">{service.memory} MB</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Uptime</span>
                        <span className="text-white">
                          {formatUptime(service.uptime)}
                        </span>
                      </div>
                    </div>
                  </Card>

                  {/* Network */}
                  <Card className="p-4 bg-slate-950 border-slate-800">
                    <h4 className="text-sm font-semibold text-white mb-3">
                      Network
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-400">RX Rate</span>
                        <span className="text-white">
                          {service.networkRx} KB/s
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">TX Rate</span>
                        <span className="text-white">
                          {service.networkTx} KB/s
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Ports</span>
                        <span className="text-white font-mono">
                          {service.name === "web" && "8080:80"}
                          {service.name === "api" && "3000:3000"}
                          {service.name === "db" && "5432:5432"}
                        </span>
                      </div>
                    </div>
                  </Card>

                  {/* Container */}
                  <Card className="p-4 bg-slate-950 border-slate-800">
                    <h4 className="text-sm font-semibold text-white mb-3">
                      Container
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Image</span>
                        <span className="text-white text-xs">
                          {service.name === "web" && "nginx:alpine"}
                          {service.name === "api" && "node:18-alpine"}
                          {service.name === "db" && "postgres:15"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">ID</span>
                        <span className="text-white font-mono text-xs">
                          {service.name === "web" && "a1b2c3d4e5"}
                          {service.name === "api" && "f6g7h8i9j0"}
                          {service.name === "db" && "k1l2m3n4o5"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Platform</span>
                        <span className="text-white text-xs">linux/amd64</span>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* Logs */}
                <div className="border-t border-slate-800">
                  <div className="p-4 bg-slate-950 flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-slate-400" />
                    <h4 className="text-sm font-semibold text-white">
                      Container Logs
                    </h4>
                  </div>
                  <div className="p-6 bg-black font-mono text-sm max-h-[300px] overflow-y-auto">
                    {logs[service.name]?.map((log, index) => (
                      <div key={index} className="py-1 text-green-400">
                        <span className="text-slate-600 mr-3">{index + 1}</span>
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </Card>

        {/* Actions */}
        <div className="flex gap-4 mt-6">
          <Button
            onClick={() => navigate("/execution")}
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            View File Analysis
          </Button>
          <Button
            onClick={() => navigate("/")}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Analyze New Project
          </Button>
        </div>
      </div>
    </Layout>
  );
}
