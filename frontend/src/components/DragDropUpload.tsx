import { useRef, useState } from "react";
import { Upload, FileCode } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "./ui/button";
import type { DockerFileKind } from "../utils/fileType";
import { dragActiveVariants, dragActiveTransition } from "./motion/variants";

interface DragDropUploadProps {
  onFileSelect: (file: File, hint?: DockerFileKind) => void;
}

const DOCKERFILE_ACCEPT = ".dockerfile,Dockerfile,dockerfile,text/plain";
const COMPOSE_ACCEPT = ".yml,.yaml,application/x-yaml,text/yaml,text/plain";
const DROP_ACCEPT = `${DOCKERFILE_ACCEPT},${COMPOSE_ACCEPT}`;

export function DragDropUpload({ onFileSelect }: DragDropUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const reducedMotion = useReducedMotion();
  const dockerfileInputRef = useRef<HTMLInputElement>(null);
  const composeInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleInputChange =
    (hint: DockerFileKind) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onFileSelect(file, hint);
      }
      e.target.value = "";
    };

  return (
    <motion.div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      animate={isDragging ? "active" : "idle"}
      variants={reducedMotion ? undefined : dragActiveVariants}
      transition={dragActiveTransition}
      className={`
        border-2 border-dashed rounded-lg p-12
        ${
          isDragging
            ? "border-blue-500 bg-blue-500/5"
            : "border-slate-700 bg-slate-900/50 hover:border-slate-600 motion-safe:transition-[border-color,background-color] motion-safe:duration-200"
        }
      `}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <motion.div
          animate={isDragging ? { scale: 1.1 } : { scale: 1 }}
          transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`p-4 rounded-full ${isDragging ? "bg-blue-500/20" : "bg-slate-800"}`}
        >
          <motion.div
            animate={isDragging && !reducedMotion ? { y: [-3, 0, -3] } : { y: 0 }}
            transition={isDragging && !reducedMotion ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
          >
          <Upload
            className={`w-8 h-8 ${isDragging ? "text-blue-400" : "text-slate-400"}`}
          />
          </motion.div>
        </motion.div>

        <div>
          <h3 className="text-lg font-medium text-white mb-2">
            Drop your Docker file here
          </h3>
          <p className="text-slate-400 text-sm mb-4">
            Supported: Dockerfile (any name), docker-compose.yml / compose.yaml
          </p>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => dockerfileInputRef.current?.click()}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <FileCode className="w-4 h-4 mr-2" />
            Select Dockerfile
          </Button>
          <Button
            onClick={() => composeInputRef.current?.click()}
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <FileCode className="w-4 h-4 mr-2" />
            Select docker-compose.yml
          </Button>
        </div>

        <input
          ref={dockerfileInputRef}
          type="file"
          accept={DOCKERFILE_ACCEPT}
          onChange={handleInputChange("dockerfile")}
          className="hidden"
        />
        <input
          ref={composeInputRef}
          type="file"
          accept={COMPOSE_ACCEPT}
          onChange={handleInputChange("docker-compose")}
          className="hidden"
        />
        <input
          type="file"
          accept={DROP_ACCEPT}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
    </motion.div>
  );
}
