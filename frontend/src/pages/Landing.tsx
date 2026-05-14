import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";
import { Layout } from "../components/Layout";
import { DragDropUpload } from "../components/DragDropUpload";
import { QuickDemo } from "../components/QuickDemo";
import { MotionPage, StaggerList, StaggerItem, MotionCard } from "../components/motion";
import {
  ArrowRight,
  FileCode,
  Shield,
  CheckCircle,
  Play,
  Package,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { detectFileKind, type DockerFileKind } from "../utils/fileType";

export function Landing() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

  const handleFileSelect = (file: File, hint?: DockerFileKind) => {
    const reader = new FileReader();
    reader.onerror = () => {
      toast.error(`Could not read ${file.name}.`);
    };
    reader.onload = (e) => {
      const content = (e.target?.result as string) ?? "";
      const detection = detectFileKind(file.name, content, hint);

      if (detection.kind === "unknown") {
        toast.error("Unsupported file", { description: detection.reason });
        return;
      }

      if (hint && hint !== detection.kind && detection.confidence === "high") {
        toast.message("Detected a different file type", {
          description: `You picked "${hint}" but the contents look like "${detection.kind}". Using ${detection.kind}.`,
        });
      }

      sessionStorage.setItem(
        "uploadedFile",
        JSON.stringify({
          name: file.name,
          content,
          type: detection.kind,
        }),
      );
      navigate("/upload");
    };
    reader.readAsText(file);
  };

  return (
    <Layout>
      <MotionPage>
      <div className="max-w-5xl mx-auto">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <motion.h1
            className="text-5xl font-bold text-white mb-4"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            Docker Analyzer
          </motion.h1>
          <motion.p
            className="text-xl text-slate-400 max-w-2xl mx-auto"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.08 }}
          >
            Upload your Dockerfile or docker-compose.yml to analyze for errors,
            security issues, and best practices. Get instant feedback from
            industry-standard linters.
          </motion.p>
        </div>

        {/* Upload Area */}
        <div className="mb-8">
          <DragDropUpload onFileSelect={handleFileSelect} />
        </div>

        {/* Or Upload Project */}
        <div className="mb-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-slate-800"></div>
            <span className="text-slate-500 text-sm">OR</span>
            <div className="flex-1 h-px bg-slate-800"></div>
          </div>
          <Card className="p-8 bg-slate-900 border-slate-800 text-center">
            <div className="flex flex-col items-center">
              <div className="p-4 bg-purple-500/10 rounded-full mb-4">
                <Package className="w-8 h-8 text-purple-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                Upload Complete Project
              </h3>
              <p className="text-slate-400 mb-6 max-w-md">
                Upload a full project archive to build Docker images, analyze
                layers, and monitor runtime resource usage
              </p>
              <Button
                onClick={() => navigate("/project-upload")}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Package className="w-4 h-4 mr-2" />
                Upload Project Archive
              </Button>
            </div>
          </Card>
        </div>

        {/* Pipeline Visual */}
        <div className="mb-16">
          <motion.h2
            className="text-2xl font-semibold text-white mb-6 text-center"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.15 }}
          >
            Analysis Pipeline
          </motion.h2>
          <StaggerList className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-4">
            <StaggerItem>
              <MotionCard>
              <Card className="p-6 bg-slate-900 border-slate-800 h-full">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center mb-4">
                    <FileCode className="w-6 h-6 text-blue-400" />
                  </div>
                  <h3 className="font-semibold text-white mb-2">Upload</h3>
                  <p className="text-sm text-slate-400">
                    Upload your Docker configuration file
                  </p>
                </div>
              </Card>
              </MotionCard>
            </StaggerItem>

            <StaggerItem className="hidden md:flex items-center justify-center">
              <motion.div
                animate={reducedMotion ? {} : { x: [0, 4, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <ArrowRight className="w-6 h-6 text-slate-500" />
              </motion.div>
            </StaggerItem>

            <StaggerItem>
              <MotionCard>
              <Card className="p-6 bg-slate-900 border-slate-800 h-full">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center mb-4">
                    <Shield className="w-6 h-6 text-purple-400" />
                  </div>
                  <h3 className="font-semibold text-white mb-2">Lint</h3>
                  <p className="text-sm text-slate-400">
                    Run security and best practice checks
                  </p>
                </div>
              </Card>
              </MotionCard>
            </StaggerItem>

            <StaggerItem className="hidden md:flex items-center justify-center">
              <motion.div
                animate={reducedMotion ? {} : { x: [0, 4, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
              >
                <ArrowRight className="w-6 h-6 text-slate-500" />
              </motion.div>
            </StaggerItem>

            <StaggerItem>
              <MotionCard>
              <Card className="p-6 bg-slate-900 border-slate-800 h-full">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                    <CheckCircle className="w-6 h-6 text-green-400" />
                  </div>
                  <h3 className="font-semibold text-white mb-2">Report</h3>
                  <p className="text-sm text-slate-400">
                    Get detailed analysis results
                  </p>
                </div>
              </Card>
              </MotionCard>
            </StaggerItem>

            <StaggerItem className="hidden md:flex items-center justify-center">
              <motion.div
                animate={reducedMotion ? {} : { x: [0, 4, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
              >
                <ArrowRight className="w-6 h-6 text-slate-500" />
              </motion.div>
            </StaggerItem>

            <StaggerItem>
              <MotionCard>
              <Card className="p-6 bg-slate-900 border-slate-800 h-full">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center mb-4">
                    <Play className="w-6 h-6 text-orange-400" />
                  </div>
                  <h3 className="font-semibold text-white mb-2">
                    Run Containers
                  </h3>
                  <p className="text-sm text-slate-400">
                    Execute and monitor containers
                  </p>
                </div>
              </Card>
              </MotionCard>
            </StaggerItem>
          </StaggerList>
        </div>

        {/* Features */}
        <StaggerList className="grid md:grid-cols-3 gap-6">
          <StaggerItem>
            <MotionCard>
            <Card className="p-6 bg-slate-900 border-slate-800 h-full">
              <h3 className="font-semibold text-white mb-3">Security Analysis</h3>
              <p className="text-slate-400 text-sm">
                Detect security vulnerabilities and risky configurations in your
                Docker files
              </p>
            </Card>
            </MotionCard>
          </StaggerItem>

          <StaggerItem>
            <MotionCard>
            <Card className="p-6 bg-slate-900 border-slate-800 h-full">
              <h3 className="font-semibold text-white mb-3">Best Practices</h3>
              <p className="text-slate-400 text-sm">
                Get recommendations based on Docker best practices and community
                standards
              </p>
            </Card>
            </MotionCard>
          </StaggerItem>

          <StaggerItem>
            <MotionCard>
            <Card className="p-6 bg-slate-900 border-slate-800 h-full">
              <h3 className="font-semibold text-white mb-3">
                Container Execution
              </h3>
              <p className="text-slate-400 text-sm">
                Run Docker Compose services and view real-time container logs
              </p>
            </Card>
            </MotionCard>
          </StaggerItem>
        </StaggerList>

        {/* Quick Demo */}
        <div className="mt-16">
          <QuickDemo />
        </div>
      </div>
      </MotionPage>
    </Layout>
  );
}
