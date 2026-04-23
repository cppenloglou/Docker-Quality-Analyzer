import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { TerminalLog } from "../components/TerminalLog";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Play,
  Square,
  ArrowLeft,
  Container,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { deployCompose } from "../utils/api";

interface Service {
  name: string;
  image: string;
  status: "stopped" | "starting" | "running" | "error";
  ports?: string[];
}

export function ContainerExecution() {
  const navigate = useNavigate();
  const [services, setServices] = useState<Service[]>([
    {
      name: "web",
      image: "nginx:alpine",
      status: "stopped",
      ports: ["8080:80"],
    },
    {
      name: "api",
      image: "node:18-alpine",
      status: "stopped",
      ports: ["3000:3000"],
    },
    {
      name: "db",
      image: "postgres:15-alpine",
      status: "stopped",
      ports: ["5432:5432"],
    },
  ]);
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedService, setSelectedService] = useState<string>("web");
  const deployBlockedReasons = useMemo(() => {
    const fileData = sessionStorage.getItem("uploadedFile");
    if (!fileData) return [];
    try {
      const parsedFile = JSON.parse(fileData) as { type?: string };
      const parsedResult = JSON.parse(
        sessionStorage.getItem("analysisResults") || "{}",
      ) as { meta?: { runnability?: { runnable?: boolean; reasons?: string[] } } };
      if (
        parsedFile.type === "docker-compose" &&
        parsedResult.meta?.runnability?.runnable !== true
      ) {
        return parsedResult.meta?.runnability?.reasons || [
          "Compose deployment is blocked for standalone file analysis.",
        ];
      }
      return [];
    } catch {
      return [
        "Unable to verify compose runnability. Upload full project for deployment.",
      ];
    }
  }, []);

  useEffect(() => {
    const fileData = sessionStorage.getItem("uploadedFile");
    if (!fileData) {
      navigate("/");
    }
  }, [navigate]);

  const handleRunAll = () => {
    if (deployBlockedReasons.length > 0) {
      setLogs((prev) => [
        ...prev,
        "[blocked] Deploy denied by runnability precheck.",
      ]);
      return;
    }
    const jobId = sessionStorage.getItem("analysisJobId");
    if (jobId) {
      deployCompose({
        job_id: jobId,
        push_public_images: true,
        run_stack: true,
      }).catch(() => undefined);
    }
    setLogs((prev) => [...prev, "> docker-compose up -d"]);
    setLogs((prev) => [
      ...prev,
      'Creating network "app_default" with the default driver',
    ]);

    services.forEach((service, index) => {
      setTimeout(() => {
        setServices((prev) =>
          prev.map((s) =>
            s.name === service.name ? { ...s, status: "starting" } : s,
          ),
        );
        setLogs((prev) => [...prev, `Creating ${service.name}...`]);

        setTimeout(() => {
          setServices((prev) =>
            prev.map((s) =>
              s.name === service.name ? { ...s, status: "running" } : s,
            ),
          );
          setLogs((prev) => [
            ...prev,
            `✓ ${service.name} started successfully`,
          ]);
          if (service.name === "web") {
            sessionStorage.setItem("activeContainerId", `${service.name}-container`);
          }
        }, 1500);
      }, index * 2000);
    });
  };

  const handleStopAll = () => {
    setLogs((prev) => [...prev, "> docker-compose down"]);
    setServices((prev) => prev.map((s) => ({ ...s, status: "stopped" })));
    setLogs((prev) => [...prev, "Stopping containers..."]);
    setLogs((prev) => [...prev, "✓ All containers stopped"]);
  };

  const handleServiceClick = (serviceName: string) => {
    setSelectedService(serviceName);
    // Simulate fetching logs for the service
    setLogs([
      `Showing logs for ${serviceName}...`,
      `[${serviceName}] Container started`,
      `[${serviceName}] Initializing application...`,
      `[${serviceName}] Listening on port ${services.find((s) => s.name === serviceName)?.ports?.[0]?.split(":")[1] || "8080"}`,
      `[${serviceName}] Ready to accept connections`,
    ]);
  };

  const isAnyRunning = services.some(
    (s) => s.status === "running" || s.status === "starting",
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/results")}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Results
          </Button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">
                Container Execution
              </h1>
              <p className="text-slate-400">
                Run and monitor your Docker Compose services
              </p>
            </div>
            <div className="flex gap-3">
              {isAnyRunning ? (
                <Button
                  onClick={handleStopAll}
                  variant="outline"
                  className="border-red-700 text-red-400 hover:bg-red-900/20"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop All
                </Button>
              ) : (
                <Button
                  onClick={handleRunAll}
                  disabled={deployBlockedReasons.length > 0}
                  title={
                    deployBlockedReasons.length > 0
                      ? "Upload the full project to deploy this compose stack."
                      : "Run compose deployment flow"
                  }
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Run All Containers
                </Button>
              )}
            </div>
          </div>
        </div>

        {deployBlockedReasons.length > 0 && (
          <Card className="p-4 bg-amber-500/10 border-amber-500/30 mb-6">
            <p className="text-amber-300 text-sm font-medium mb-2">
              Deploy blocked for standalone compose analysis:
            </p>
            <ul className="text-sm text-slate-300 list-disc list-inside space-y-1">
              {deployBlockedReasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </Card>
        )}

        {/* Services Grid */}
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          {services.map((service) => (
            <Card
              key={service.name}
              onClick={() => handleServiceClick(service.name)}
              className={`p-4 bg-slate-900 border-slate-800 cursor-pointer transition-all hover:border-blue-500 ${
                selectedService === service.name
                  ? "border-blue-500 bg-slate-900/80"
                  : ""
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Container className="w-5 h-5 text-blue-400" />
                  <h3 className="font-semibold text-white">{service.name}</h3>
                </div>
                {service.status === "running" && (
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                )}
                {service.status === "starting" && (
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm text-slate-400 font-mono">
                  {service.image}
                </div>

                <Badge
                  className={
                    service.status === "running"
                      ? "bg-green-500/20 text-green-400 border-green-500/30"
                      : service.status === "starting"
                        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                        : "bg-slate-700/20 text-slate-400 border-slate-700/30"
                  }
                >
                  {service.status === "running"
                    ? "● Running"
                    : service.status === "starting"
                      ? "◐ Starting"
                      : "○ Stopped"}
                </Badge>

                {service.ports && service.ports.length > 0 && (
                  <div className="text-xs text-slate-500 mt-2">
                    Ports: {service.ports.join(", ")}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>

        {/* Container Logs */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">
              Container Logs - {selectedService}
            </h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLogs([])}
              className="border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              Clear Logs
            </Button>
          </div>
          <TerminalLog
            logs={logs}
            title={`${selectedService} logs`}
            maxHeight="400px"
          />
        </div>

        {/* Docker Compose Configuration Preview */}
        <Card className="p-6 bg-slate-900 border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-4">
            Detected Services
          </h3>
          <div className="bg-slate-950 rounded-lg p-4 font-mono text-sm">
            <div className="text-slate-400">
              <div className="text-blue-400">version: '3.8'</div>
              <div className="text-blue-400 mt-2">services:</div>
              {services.map((service, index) => (
                <div key={index} className="ml-4 mt-2">
                  <div className="text-green-400"> {service.name}:</div>
                  <div className="ml-4 text-slate-300">
                    {" "}
                    image: {service.image}
                  </div>
                  {service.ports && (
                    <>
                      <div className="ml-4 text-slate-300"> ports:</div>
                      {service.ports.map((port, portIndex) => (
                        <div key={portIndex} className="ml-8 text-slate-300">
                          {" "}
                          - "{port}"
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Info Box */}
        <Card className="mt-6 p-4 bg-blue-500/10 border-blue-500/30">
          <div className="flex gap-3">
            <div className="text-blue-400 mt-1">ℹ️</div>
            <div>
              <p className="text-blue-300 text-sm">
                <strong>Note:</strong> This is a simulation of container
                execution with a live deploy trigger to the backend workflow.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
