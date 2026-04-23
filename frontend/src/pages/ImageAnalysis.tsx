import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import {
  Package,
  Layers,
  HardDrive,
  Image as ImageIcon,
  ArrowLeft,
  TrendingUp,
  Database,
  Play,
} from "lucide-react";
import { MOCK_IMAGE_LAYERS } from "../utils/mockData";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

export function ImageAnalysis() {
  const navigate = useNavigate();

  // Calculate total size
  const parseSize = (sizeStr: string) => {
    if (sizeStr === "0 B") return 0;
    const units: { [key: string]: number } = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };
    const match = sizeStr.match(/^([\d.]+)\s*([A-Z]+)$/);
    if (!match) return 0;
    return parseFloat(match[1]) * units[match[2]];
  };

  const totalSizeBytes = MOCK_IMAGE_LAYERS.reduce(
    (sum: number, layer: (typeof MOCK_IMAGE_LAYERS)[0]) =>
      sum + parseSize(layer.size),
    0,
  );
  const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(1);

  // Prepare data for charts
  const layerData = MOCK_IMAGE_LAYERS.filter(
    (l: (typeof MOCK_IMAGE_LAYERS)[0]) => parseSize(l.size) > 0,
  ).map((layer: (typeof MOCK_IMAGE_LAYERS)[0], index: number) => ({
    id: `layer-${index}`,
    name: layer.command.split(" ")[0],
    size: parseSize(layer.size) / (1024 * 1024), // Convert to MB
  }));

  const sizeBreakdown = [
    { name: "Base Image", value: 118, color: "#3b82f6" },
    { name: "Dependencies", value: 45.2, color: "#8b5cf6" },
    { name: "Application", value: 0.0128, color: "#10b981" },
  ];

  const resourceEstimate = [
    { metric: "CPU (Idle)", value: 5, max: 100 },
    { metric: "Memory", value: 120, max: 512 },
    { metric: "Disk I/O", value: 15, max: 100 },
  ];

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/image-build")}
            className="text-slate-400 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Build
          </Button>
          <h1 className="text-3xl font-bold text-white">
            Docker Image Analysis
          </h1>
          <p className="text-slate-400 mt-2">
            Detailed analysis of your built Docker image
          </p>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-400 text-sm mb-1">Total Image Size</p>
                <p className="text-3xl font-bold text-white">
                  {totalSizeMB} MB
                </p>
                <p className="text-xs text-green-400 mt-2 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  32% smaller than avg
                </p>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <HardDrive className="w-6 h-6 text-blue-400" />
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-400 text-sm mb-1">Total Layers</p>
                <p className="text-3xl font-bold text-white">
                  {MOCK_IMAGE_LAYERS.length}
                </p>
                <p className="text-xs text-slate-500 mt-2">3 layers cached</p>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-lg">
                <Layers className="w-6 h-6 text-purple-400" />
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-400 text-sm mb-1">Base Image</p>
                <p className="text-lg font-bold text-white">node:18-alpine</p>
                <p className="text-xs text-slate-500 mt-2">Version 18.20.1</p>
              </div>
              <div className="p-3 bg-green-500/10 rounded-lg">
                <ImageIcon className="w-6 h-6 text-green-400" />
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-400 text-sm mb-1">Est. Memory</p>
                <p className="text-3xl font-bold text-white">120 MB</p>
                <p className="text-xs text-slate-500 mt-2">At startup</p>
              </div>
              <div className="p-3 bg-orange-500/10 rounded-lg">
                <Database className="w-6 h-6 text-orange-400" />
              </div>
            </div>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Layer Size Breakdown */}
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-2 mb-6">
              <Layers className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-white">
                Layer Size Breakdown
              </h2>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={layerData}>
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
                  dataKey="size"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Size Distribution */}
          <Card className="p-6 bg-slate-900 border-slate-800">
            <div className="flex items-center gap-2 mb-6">
              <Package className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-white">
                Size Distribution
              </h2>
            </div>
            <div className="flex items-center justify-between">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie
                    data={sizeBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {sizeBreakdown.map((entry, index) => (
                      <Cell
                        key={`pie-cell-${entry.name}-${index}`}
                        fill={entry.color}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-3">
                {sizeBreakdown.map((item, index) => (
                  <div
                    key={`legend-${item.name}-${index}`}
                    className="flex items-center gap-2"
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    ></div>
                    <div>
                      <p className="text-sm text-slate-300">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.value} MB</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Resource Usage Estimates */}
        <Card className="p-6 bg-slate-900 border-slate-800 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">
              Estimated Resource Usage
            </h2>
          </div>
          <div className="space-y-4">
            {resourceEstimate.map((resource, index) => (
              <div key={index}>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-slate-300">{resource.metric}</span>
                  <span className="text-white font-medium">
                    {resource.value}{" "}
                    {resource.metric.includes("Memory") ? "MB" : "%"}
                  </span>
                </div>
                <Progress
                  value={(resource.value / resource.max) * 100}
                  className="h-2"
                />
              </div>
            ))}
          </div>
          <div className="mt-6 p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
            <p className="text-sm text-slate-400">
              These are estimated values based on the image configuration.
              Actual runtime usage may vary depending on your application
              workload.
            </p>
          </div>
        </Card>

        {/* Image Layers Detail */}
        <Card className="bg-slate-900 border-slate-800">
          <div className="p-6 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-white">Image Layers</h2>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-950 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Layer ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Command
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {MOCK_IMAGE_LAYERS.map((layer, index) => (
                  <tr key={index} className="hover:bg-slate-800/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="text-xs text-blue-400 font-mono">
                        {layer.id}
                      </code>
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-sm text-slate-300 font-mono">
                        {layer.command}
                      </code>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge
                        className={
                          parseSize(layer.size) > 50 * 1024 * 1024
                            ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                            : parseSize(layer.size) > 0
                              ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                              : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                        }
                      >
                        {layer.size}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                      {layer.created}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex gap-4 mt-6">
          <Button
            onClick={() => navigate("/project-upload")}
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Build New Image
          </Button>
          <Button
            onClick={() => navigate("/runtime-monitoring")}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Play className="w-4 h-4 mr-2" />
            Run Container & Monitor
          </Button>
        </div>
      </div>
    </Layout>
  );
}
