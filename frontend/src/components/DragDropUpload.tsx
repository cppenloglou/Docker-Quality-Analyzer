import { useState } from "react";
import { Upload, FileCode } from "lucide-react";
import { Button } from "./ui/button";

interface DragDropUploadProps {
  onFileSelect: (file: File) => void;
  acceptedTypes?: string;
}

export function DragDropUpload({
  onFileSelect,
  acceptedTypes = ".dockerfile,Dockerfile,.yml,.yaml",
}: DragDropUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

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

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onFileSelect(files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFileSelect(files[0]);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-lg p-12 transition-all duration-200
        ${
          isDragging
            ? "border-blue-500 bg-blue-500/5 scale-[1.02]"
            : "border-slate-700 bg-slate-900/50 hover:border-slate-600"
        }
      `}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <div
          className={`p-4 rounded-full ${isDragging ? "bg-blue-500/20" : "bg-slate-800"}`}
        >
          <Upload
            className={`w-8 h-8 ${isDragging ? "text-blue-400" : "text-slate-400"}`}
          />
        </div>

        <div>
          <h3 className="text-lg font-medium text-white mb-2">
            Drop your Docker file here
          </h3>
          <p className="text-slate-400 text-sm mb-4">
            Supported: Dockerfile, docker-compose.yml
          </p>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => document.getElementById("dockerfile-input")?.click()}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <FileCode className="w-4 h-4 mr-2" />
            Select Dockerfile
          </Button>
          <Button
            onClick={() => document.getElementById("compose-input")?.click()}
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <FileCode className="w-4 h-4 mr-2" />
            Select docker-compose.yml
          </Button>
        </div>

        <input
          id="dockerfile-input"
          type="file"
          accept={acceptedTypes}
          onChange={handleFileInput}
          className="hidden"
        />
        <input
          id="compose-input"
          type="file"
          accept={acceptedTypes}
          onChange={handleFileInput}
          className="hidden"
        />
      </div>
    </div>
  );
}
