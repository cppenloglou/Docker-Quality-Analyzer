import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { FileCode, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SAMPLE_DOCKERFILE, SAMPLE_DOCKER_COMPOSE } from "../utils/samples";

export function QuickDemo() {
  const navigate = useNavigate();

  const loadSampleFile = (type: "dockerfile" | "docker-compose") => {
    sessionStorage.removeItem("batchAnalysis");
    const fileData = {
      name: type === "dockerfile" ? "Dockerfile" : "docker-compose.yml",
      content:
        type === "dockerfile" ? SAMPLE_DOCKERFILE : SAMPLE_DOCKER_COMPOSE,
      type,
    };

    sessionStorage.setItem("uploadedFile", JSON.stringify(fileData));
    navigate("/analysis");
  };

  return (
    <Card className="p-6 bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-border">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-blue-500/20 rounded-lg">
          <Zap className="w-6 h-6 text-blue-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Try a Quick Demo
          </h3>
          <p className="text-muted-foreground mb-4 text-sm">
            No Docker file handy? Runs analysis immediately with a sample file.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => loadSampleFile("dockerfile")}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
            >
              <FileCode className="w-4 h-4 mr-2" />
              Demo Dockerfile
            </Button>
            <Button
              onClick={() => loadSampleFile("docker-compose")}
              size="sm"
              variant="outline"
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <FileCode className="w-4 h-4 mr-2" />
              Demo Compose
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
