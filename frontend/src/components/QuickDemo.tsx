import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { FileCode, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SAMPLE_DOCKERFILE, SAMPLE_DOCKER_COMPOSE } from "../utils/mockData";

export function QuickDemo() {
  const navigate = useNavigate();

  const loadSampleFile = (type: "dockerfile" | "docker-compose") => {
    const fileData = {
      name: type === "dockerfile" ? "Dockerfile" : "docker-compose.yml",
      content:
        type === "dockerfile" ? SAMPLE_DOCKERFILE : SAMPLE_DOCKER_COMPOSE,
      type,
    };

    sessionStorage.setItem("uploadedFile", JSON.stringify(fileData));
    navigate("/upload");
  };

  return (
    <Card className="p-6 bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/30">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-blue-500/20 rounded-lg">
          <Zap className="w-6 h-6 text-blue-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white mb-2">
            Try a Quick Demo
          </h3>
          <p className="text-slate-300 mb-4 text-sm">
            Don't have a Docker file handy? Load a sample file to see the
            analyzer in action.
          </p>
          <div className="flex gap-3">
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
              className="border-blue-500/50 text-blue-300 hover:bg-blue-500/10"
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
