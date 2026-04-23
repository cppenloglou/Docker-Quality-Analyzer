import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { CodePreview } from "../components/CodePreview";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { FileCode, Play, ArrowLeft } from "lucide-react";
import { Badge } from "../components/ui/badge";

export function FileUpload() {
  const navigate = useNavigate();
  const [fileData] = useState<{
    name: string;
    content: string;
    type: string;
  } | null>(() => {
    const stored = sessionStorage.getItem("uploadedFile");
    return stored ? JSON.parse(stored) : null;
  });

  useEffect(() => {
    if (!fileData) {
      navigate("/");
    }
  }, [fileData, navigate]);

  const handleStartAnalysis = () => {
    navigate("/analysis");
  };

  if (!fileData) return null;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="text-slate-400 hover:text-white mb-4"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
            <h1 className="text-3xl font-bold text-white">File Upload</h1>
            <p className="text-slate-400 mt-2">
              Review your file before analysis
            </p>
          </div>
        </div>

        {/* File Info Card */}
        <Card className="p-6 bg-slate-900 border-slate-800 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <FileCode className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white mb-2">
                  {fileData.name}
                </h2>
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                    {fileData.type === "docker-compose"
                      ? "Docker Compose"
                      : "Dockerfile"}
                  </Badge>
                  <span className="text-sm text-slate-500">
                    {fileData.content.split("\n").length} lines
                  </span>
                  <span className="text-sm text-slate-500">
                    {(fileData.content.length / 1024).toFixed(2)} KB
                  </span>
                </div>
              </div>
            </div>

            <Button
              onClick={handleStartAnalysis}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Play className="w-4 h-4 mr-2" />
              Start Analysis
            </Button>
          </div>
        </Card>

        {/* Code Preview */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">
            Code Preview
          </h3>
          <CodePreview
            code={fileData.content}
            language={fileData.type === "docker-compose" ? "yaml" : "docker"}
            maxHeight="600px"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 mt-8">
          <Button
            onClick={() => navigate("/")}
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Upload Different File
          </Button>
          <Button
            onClick={handleStartAnalysis}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Play className="w-4 h-4 mr-2" />
            Start Analysis
          </Button>
        </div>
      </div>
    </Layout>
  );
}
